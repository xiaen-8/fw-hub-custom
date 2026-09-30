import { NextRequest, NextResponse } from "next/server";

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify admin authentication from request cookie.
 * Returns null if authenticated, or a 401/403 NextResponse if not.
 * This provides defense-in-depth — routes are also protected by middleware.
 */
export async function verifyAdmin(
  request: NextRequest
): Promise<NextResponse | null> {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return NextResponse.json({ error: "Admin not enabled" }, { status: 403 });
  }

  const cookie = request.cookies.get("fwh_admin")?.value;
  if (!cookie) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hash = await sha256(adminPassword);
  if (cookie !== hash) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null; // authenticated
}
