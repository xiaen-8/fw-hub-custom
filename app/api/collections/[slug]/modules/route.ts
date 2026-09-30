import { NextRequest, NextResponse } from "next/server";
import { getBackendDb, getBackendStore } from "@/lib/backend";
import { extractToken, authenticateToken, checkRateLimit } from "@/lib/auth";

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * POST /api/collections/[slug]/modules
 * 把模块池中的已有模块加入到该合集（移动，会复制文件到合集目录）
 * body: { module_ids: string[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } },
    );
  }

  const token = extractToken(request);
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 401 });
  const auth = await authenticateToken(token);
  if (!auth) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const { slug } = await params;
  const db = await getBackendDb();
  const collection = (await db
    .prepare("SELECT id, slug FROM collections WHERE slug = ? AND user_id = ?")
    .get(slug, auth.userId)) as { id: string; slug: string } | undefined;
  if (!collection) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const moduleIds = body?.module_ids;
  if (!Array.isArray(moduleIds) || moduleIds.length === 0) {
    return NextResponse.json({ error: "module_ids 不能为空" }, { status: 400 });
  }

  const store = await getBackendStore();
  const moved: string[] = [];
  const skipped: string[] = [];

  for (const moduleId of moduleIds) {
    if (typeof moduleId !== "string") continue;
    const mod = (await db
      .prepare(
        `SELECT m.id, m.collection_id, m.filename, m.oss_key, c.user_id
         FROM modules m JOIN collections c ON m.collection_id = c.id
         WHERE m.id = ?`,
      )
      .get(moduleId)) as
      | { id: string; collection_id: string; filename: string; oss_key: string | null; user_id: string }
      | undefined;

    if (!mod || mod.user_id !== auth.userId) {
      skipped.push(moduleId);
      continue;
    }
    if (mod.collection_id === collection.id) {
      skipped.push(moduleId);
      continue;
    }

    try {
      const oldKey = mod.oss_key || mod.filename;
      const content = await store.read(mod.collection_id, oldKey);
      if (!content) {
        skipped.push(moduleId);
        continue;
      }

      // 目标目录同名文件冲突时加前缀，避免覆盖
      let filename = mod.filename;
      const conflict = (await db
        .prepare("SELECT id FROM modules WHERE collection_id = ? AND filename = ?")
        .get(collection.id, filename)) as { id: string } | undefined;
      if (conflict) filename = `${mod.id.slice(0, 6)}_${mod.filename}`;

      const savedKey = await store.save(collection.id, filename, Buffer.from(content));
      const newOssKey = (savedKey as string) || filename;

      await db
        .prepare(
          "UPDATE modules SET collection_id = ?, filename = ?, oss_key = ?, updated_at = unixepoch() WHERE id = ?",
        )
        .run(collection.id, filename, newOssKey, mod.id);

      await store.remove(mod.collection_id, oldKey).catch(() => {});
      moved.push(moduleId);
    } catch {
      skipped.push(moduleId);
    }
  }

  const modules = await db
    .prepare(
      "SELECT id, filename, widget_id, title, description, version, author, file_size, is_encrypted, source_url, created_at FROM modules WHERE collection_id = ? ORDER BY created_at",
    )
    .all(collection.id);

  return NextResponse.json({ success: true, moved, skipped, modules });
}
