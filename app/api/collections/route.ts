import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getBackendDb, getBackendStore } from "@/lib/backend";
import { extractToken, authenticateToken, checkRateLimit } from "@/lib/auth";

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** POST /api/collections — 新建一个空合集 */
export async function POST(request: NextRequest) {
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

  const formData = await request.formData();
  const title = ((formData.get("title") as string) || "").trim();
  const description = ((formData.get("description") as string) || "").trim();
  if (!title) return NextResponse.json({ error: "标题不能为空" }, { status: 400 });

  const db = await getBackendDb();
  const collectionId = nanoid();
  const slug = nanoid(10);

  // 可选图标
  let iconUrl = "";
  const iconFile = formData.get("icon") as File | null;
  if (iconFile && iconFile.size > 0) {
    const store = await getBackendStore();
    const contentType = iconFile.type || "image/png";
    const ext = contentType.includes("png") ? "png"
      : contentType.includes("gif") ? "gif"
      : contentType.includes("webp") ? "webp"
      : contentType.includes("svg") ? "svg"
      : "jpg";
    const buffer = Buffer.from(await iconFile.arrayBuffer());
    const iconFilename = `_icon.${ext}`;
    const savedKey = await store.save(collectionId, iconFilename, buffer);
    const actualKey = (savedKey as string) || iconFilename;
    const cdnUrl = store.getUrl?.(collectionId, actualKey);
    const proto = request.headers.get("x-forwarded-proto") || "https";
    const host = request.headers.get("host") || request.nextUrl.host;
    iconUrl = cdnUrl || `${proto}://${host}/api/collections/${slug}/icon`;
  }

  await db
    .prepare(
      "INSERT INTO collections (id, user_id, slug, title, description, icon_url) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(collectionId, auth.userId, slug, title, description, iconUrl);

  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("host") || request.nextUrl.host;
  const siteUrl = `${proto}://${host}`;

  return NextResponse.json({
    success: true,
    collection: {
      id: collectionId,
      slug,
      title,
      description,
      icon_url: iconUrl,
      fwdUrl: `${siteUrl}/api/collections/${slug}/fwd`,
      pageUrl: `${siteUrl}/c/${slug}`,
      modules: [],
    },
  });
}
