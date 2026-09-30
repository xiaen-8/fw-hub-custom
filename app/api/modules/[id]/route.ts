import { NextRequest, NextResponse } from "next/server";
import { getBackendDb, getBackendStore } from "@/lib/backend";
import { extractToken, authenticateToken, checkRateLimit } from "@/lib/auth";
import { parseWidgetMetadata, isEncrypted } from "@/lib/parser";

function getClientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } });
  }

  const token = extractToken(request);
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 401 });
  const auth = await authenticateToken(token);
  if (!auth) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const { id } = await params;
  const db = await getBackendDb();
  const store = await getBackendStore();
  const mod = await db.prepare(
    `SELECT m.id, m.collection_id, m.filename, c.user_id
     FROM modules m JOIN collections c ON m.collection_id = c.id WHERE m.id = ?`
  ).get(id) as { id: string; collection_id: string; filename: string; user_id: string } | undefined;

  if (!mod || mod.user_id !== auth.userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "File required" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 });
  }

  // Save file (overwrite)
  const ossKey = await store.save(mod.collection_id, mod.filename, buffer);

  // Update metadata
  const encrypted = isEncrypted(buffer);
  const updates: Record<string, unknown> = { file_size: buffer.length, is_encrypted: encrypted ? 1 : 0, oss_key: ossKey || null, updated_at: Math.floor(Date.now() / 1000) };

  if (!encrypted) {
    const meta = parseWidgetMetadata(buffer.toString("utf-8"));
    if (meta) {
      updates.widget_id = meta.id;
      updates.title = meta.title;
      updates.description = meta.description || null;
      updates.version = meta.version || null;
      updates.author = meta.author || null;
    }
  }

  const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
  await db.prepare(`UPDATE modules SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), id);

  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } });
  }

  const token = extractToken(request);
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 401 });
  const auth = await authenticateToken(token);
  if (!auth) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const { id } = await params;
  const db = await getBackendDb();
  const store = await getBackendStore();
  const mod = await db.prepare(
    `SELECT m.id, m.collection_id, m.filename, m.oss_key, c.user_id
     FROM modules m JOIN collections c ON m.collection_id = c.id WHERE m.id = ?`
  ).get(id) as { id: string; collection_id: string; filename: string; oss_key: string | null; user_id: string } | undefined;

  if (!mod || mod.user_id !== auth.userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.prepare("DELETE FROM modules WHERE id = ?").run(id);
  await store.remove(mod.collection_id, mod.oss_key || mod.filename);

  return NextResponse.json({ success: true });
}
