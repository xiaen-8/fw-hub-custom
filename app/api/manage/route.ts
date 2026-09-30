import { NextRequest, NextResponse } from "next/server";
import { getBackendDb } from "@/lib/backend";
import { extractToken, authenticateToken, checkRateLimit } from "@/lib/auth";

function getClientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } });
  }

  const token = extractToken(request);
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 401 });
  const auth = await authenticateToken(token);
  if (!auth) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  const db = await getBackendDb();
  const collections = await db.prepare("SELECT * FROM collections WHERE user_id = ? ORDER BY created_at DESC").all(auth.userId);

  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("host") || request.nextUrl.host;
  const siteUrl = `${proto}://${host}`;

  const result = [];
  for (const col of collections as Record<string, unknown>[]) {
    const modules = await db.prepare(
      "SELECT id, filename, widget_id, title, description, version, author, file_size, is_encrypted, source_url, created_at FROM modules WHERE collection_id = ? ORDER BY created_at"
    ).all(col.id);

    result.push({ ...col, fwdUrl: `${siteUrl}/api/collections/${col.slug}/fwd`, pageUrl: `${siteUrl}/c/${col.slug}`, modules });
  }

  return NextResponse.json({ collections: result });
}
