import crypto from "crypto";
import { getBackendDb } from "./backend";

const TOKEN_PREFIX = "fwt_";

export function generateToken(): string {
  const bytes = crypto.randomBytes(32);
  return TOKEN_PREFIX + bytes.toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getTokenPrefix(token: string): string {
  const raw = token.startsWith(TOKEN_PREFIX)
    ? token.slice(TOKEN_PREFIX.length)
    : token;
  return raw.slice(0, 6);
}

export function extractToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken;
  return null;
}

export async function authenticateToken(token: string): Promise<{ userId: string } | null> {
  const db = await getBackendDb();
  const hash = hashToken(token);
  const row = await db
    .prepare("SELECT id FROM users WHERE token_hash = ?")
    .get(hash) as { id: string } | undefined;
  if (!row) return null;
  return { userId: row.id };
}

const rateLimitMap = new Map<string, { count: number; resetAt: number; lockedUntil: number }>();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 10;
const LOCKOUT_DURATION = 15 * 60_000;

export function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW, lockedUntil: 0 };
    rateLimitMap.set(ip, entry);
  }
  if (entry.lockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    entry.lockedUntil = now + LOCKOUT_DURATION;
    return { allowed: false, retryAfter: LOCKOUT_DURATION / 1000 };
  }
  return { allowed: true };
}
