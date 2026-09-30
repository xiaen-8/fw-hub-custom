import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Admin API routes: require ADMIN_PASSWORD cookie
  if (path.startsWith("/api/admin/collections") || path.startsWith("/api/admin/modules")) {
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword)
      return NextResponse.json({ error: "Admin not enabled" }, { status: 403 });
    const cookie = request.cookies.get("fwh_admin")?.value;
    const hash = await sha256(adminPassword);
    if (cookie === hash) return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Access password routes
  const password = process.env.ACCESS_PASSWORD;
  if (!password) return NextResponse.next();

  // /api/manage and /api/upload have their own token-based auth
  if (path === "/api/manage" || path === "/api/upload") return NextResponse.next();

  const cookie = request.cookies.get("fwh_access")?.value;
  const hash = await sha256(password);
  if (cookie === hash) return NextResponse.next();

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export const config = {
  matcher: ["/api/upload", "/api/manage", "/api/admin/collections/:path*", "/api/admin/modules/:path*"],
};
