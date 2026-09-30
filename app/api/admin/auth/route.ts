import { NextRequest, NextResponse } from "next/server";

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000; // 15 minutes

function getClientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

function checkBruteForce(ip: string): { blocked: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry || now > entry.resetAt) return { blocked: false };
  if (entry.count >= MAX_ATTEMPTS) {
    return { blocked: true, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { blocked: false };
}

function recordFailure(ip: string) {
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    failedAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count++;
  }
}

function clearFailures(ip: string) {
  failedAttempts.delete(ip);
}

export async function GET(req: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return NextResponse.json({ enabled: false });

  const cookie = req.cookies.get("fwh_admin")?.value;
  const hash = await sha256(password);
  return NextResponse.json({
    enabled: true,
    authenticated: cookie === hash,
  });
}

export async function POST(req: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password)
    return NextResponse.json({ error: "Admin not enabled" }, { status: 403 });

  const ip = getClientIp(req);
  const check = checkBruteForce(ip);
  if (check.blocked) {
    return NextResponse.json(
      { error: "尝试次数过多，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(check.retryAfter) } }
    );
  }

  const { password: input } = await req.json();
  if (input !== password) {
    recordFailure(ip);
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }

  clearFailures(ip);
  const hash = await sha256(password);
  const res = NextResponse.json({ ok: true });
  res.cookies.set("fwh_admin", hash, {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return res;
}
