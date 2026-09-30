# Forward Widget Hub Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a self-hosted ForwardWidget module hosting platform where users upload .js widgets, get a management token, and share .fwd subscription links for Forward App.

**Architecture:** Next.js 15 full-stack monolith with App Router. API Routes handle uploads and CRUD. SQLite (better-sqlite3) stores metadata. Local filesystem stores module files. Single Docker container with one `/data` volume.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, better-sqlite3, nanoid, Docker

**Design doc:** `docs/plans/2026-03-07-forward-widget-hub-design.md`

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `.gitignore`

**Step 1: Initialize Next.js project**

Run from `/Users/johnil/Work/git/forward-widget-hub`:

```bash
npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir=false --import-alias="@/*" --use-npm
```

If directory is non-empty, clear `docs/` first, scaffold, then restore.

**Step 2: Install dependencies**

```bash
npm install better-sqlite3 nanoid
npm install -D @types/better-sqlite3
```

**Step 3: Configure standalone output**

In `next.config.ts`:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
```

**Step 4: Initialize shadcn/ui**

```bash
npx shadcn@latest init -d
```

**Step 5: Add commonly needed shadcn components**

```bash
npx shadcn@latest add button card input label toast sonner dialog badge separator dropdown-menu
```

**Step 6: Add `/data` to .gitignore**

Append to `.gitignore`:
```
/data
```

**Step 7: Verify dev server starts**

```bash
npm run dev
```

Open http://localhost:3000 to confirm default page loads.

**Step 8: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Next.js project with shadcn/ui and deps"
```

---

### Task 2: Database Layer

**Files:**
- Create: `lib/db.ts`
- Create: `lib/db-schema.ts`

**Step 1: Create database schema module**

Create `lib/db-schema.ts`:

```typescript
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  token_prefix TEXT NOT NULL,
  name TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  icon_url TEXT DEFAULT '',
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  widget_id TEXT,
  title TEXT,
  description TEXT DEFAULT '',
  version TEXT,
  author TEXT,
  file_size INTEGER DEFAULT 0,
  is_encrypted INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
CREATE INDEX IF NOT EXISTS idx_collections_slug ON collections(slug);
CREATE INDEX IF NOT EXISTS idx_modules_collection_id ON modules(collection_id);
CREATE INDEX IF NOT EXISTS idx_users_token_prefix ON users(token_prefix);
`;
```

**Step 2: Create database singleton module**

Create `lib/db.ts`:

```typescript
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { SCHEMA } from "./db-schema";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.sqlite");

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    _db.exec(SCHEMA);
  }
  return _db;
}
```

**Step 3: Commit**

```bash
git add lib/
git commit -m "feat: add SQLite database layer with schema"
```

---

### Task 3: Token & Auth Utilities

**Files:**
- Create: `lib/auth.ts`

**Step 1: Create auth module**

Create `lib/auth.ts`:

```typescript
import crypto from "crypto";
import { getDb } from "./db";

const TOKEN_PREFIX = "fwt_";

export function generateToken(): string {
  const bytes = crypto.randomBytes(32);
  return TOKEN_PREFIX + bytes.toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getTokenPrefix(token: string): string {
  // Strip prefix, take first 6 chars
  const raw = token.startsWith(TOKEN_PREFIX)
    ? token.slice(TOKEN_PREFIX.length)
    : token;
  return raw.slice(0, 6);
}

export function extractToken(request: Request): string | null {
  // 1. Check Authorization header
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // 2. Check URL query param
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken) {
    return queryToken;
  }

  return null;
}

export function authenticateToken(token: string): { userId: string } | null {
  const db = getDb();
  const hash = hashToken(token);
  const row = db
    .prepare("SELECT id FROM users WHERE token_hash = ?")
    .get(hash) as { id: string } | undefined;
  if (!row) return null;
  return { userId: row.id };
}

// Rate limiting: in-memory store (per-process, resets on restart)
const rateLimitMap = new Map<
  string,
  { count: number; resetAt: number; lockedUntil: number }
>();

const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10;
const LOCKOUT_DURATION = 15 * 60_000; // 15 minutes
const LOCKOUT_THRESHOLD = 5;

export function checkRateLimit(ip: string): {
  allowed: boolean;
  retryAfter?: number;
} {
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
```

**Step 2: Commit**

```bash
git add lib/auth.ts
git commit -m "feat: add token generation, hashing, and rate limiting"
```

---

### Task 4: WidgetMetadata Parser

**Files:**
- Create: `lib/parser.ts`

This parser safely extracts metadata from `.js` widget files without executing code. It uses regex to find the `WidgetMetadata` assignment (which can be `var WidgetMetadata = {...}`, `let WidgetMetadata = {...}`, or just `WidgetMetadata = {...}`), then safely evaluates only the object literal.

**Step 1: Create parser module**

Create `lib/parser.ts`:

```typescript
export interface WidgetMeta {
  id: string;
  title: string;
  description?: string;
  version?: string;
  author?: string;
  icon?: string;
  site?: string;
  requiredVersion?: string;
}

/**
 * Extract WidgetMetadata from a .js file content.
 * Uses regex to find the object literal, then JSON.parse after cleanup.
 * Does NOT execute any user code.
 */
export function parseWidgetMetadata(content: string): WidgetMeta | null {
  // Check if file starts with FWENC1 (encrypted)
  if (content.startsWith("FWENC1")) {
    return null; // Cannot parse encrypted modules
  }

  // Match: (var|let|const)? WidgetMetadata = { ... };
  // Use a brace-counting approach to extract the object
  const startMatch = content.match(
    /(?:var|let|const)?\s*WidgetMetadata\s*=\s*\{/
  );
  if (!startMatch || startMatch.index === undefined) {
    return null;
  }

  const startIdx = content.indexOf("{", startMatch.index);
  let depth = 0;
  let endIdx = -1;

  for (let i = startIdx; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }

  if (endIdx === -1) return null;

  let objStr = content.slice(startIdx, endIdx + 1);

  // Clean up JS object literal to be valid JSON:
  // 1. Remove single-line comments
  objStr = objStr.replace(/\/\/.*$/gm, "");
  // 2. Remove multi-line comments
  objStr = objStr.replace(/\/\*[\s\S]*?\*\//g, "");
  // 3. Remove trailing commas before } or ]
  objStr = objStr.replace(/,\s*([}\]])/g, "$1");
  // 4. Quote unquoted keys
  objStr = objStr.replace(
    /(?<=[{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g,
    '"$1":'
  );
  // 5. Replace single-quoted strings with double-quoted
  objStr = objStr.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
  // 6. Remove function values and array values (modules, params, search etc.)
  // We only need top-level scalar fields

  try {
    const parsed = JSON.parse(objStr);
    return {
      id: parsed.id || "",
      title: parsed.title || "",
      description: parsed.description,
      version: parsed.version,
      author: parsed.author,
      icon: parsed.icon,
      site: parsed.site,
      requiredVersion: parsed.requiredVersion,
    };
  } catch {
    // If full parse fails, try extracting individual fields with regex
    return extractFieldsFallback(content);
  }
}

function extractFieldsFallback(content: string): WidgetMeta | null {
  const extract = (field: string): string | undefined => {
    const match = content.match(
      new RegExp(`${field}\\s*:\\s*["']([^"']+)["']`)
    );
    return match?.[1];
  };

  const id = extract("id");
  const title = extract("title");
  if (!id || !title) return null;

  return {
    id,
    title,
    description: extract("description"),
    version: extract("version"),
    author: extract("author"),
    icon: extract("icon"),
    site: extract("site"),
    requiredVersion: extract("requiredVersion"),
  };
}

/**
 * Check if file content is encrypted (starts with FWENC1)
 */
export function isEncrypted(content: Buffer): boolean {
  return content.toString("utf8", 0, 6) === "FWENC1";
}
```

**Step 2: Commit**

```bash
git add lib/parser.ts
git commit -m "feat: add safe WidgetMetadata parser (no eval)"
```

---

### Task 5: File Storage Module

**Files:**
- Create: `lib/storage.ts`

**Step 1: Create storage module**

Create `lib/storage.ts`:

```typescript
import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const MODULES_DIR = path.join(DATA_DIR, "modules");

// Ensure directory exists
fs.mkdirSync(MODULES_DIR, { recursive: true });

export function getModulePath(collectionId: string, filename: string): string {
  return path.join(MODULES_DIR, collectionId, filename);
}

export function saveModule(
  collectionId: string,
  filename: string,
  content: Buffer
): void {
  const dir = path.join(MODULES_DIR, collectionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content);
}

export function readModule(
  collectionId: string,
  filename: string
): Buffer | null {
  const filePath = getModulePath(collectionId, filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

export function deleteModule(
  collectionId: string,
  filename: string
): void {
  const filePath = getModulePath(collectionId, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function deleteCollection(collectionId: string): void {
  const dir = path.join(MODULES_DIR, collectionId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
```

**Step 2: Commit**

```bash
git add lib/storage.ts
git commit -m "feat: add local file storage module"
```

---

### Task 6: Upload API

**Files:**
- Create: `app/api/upload/route.ts`

**Step 1: Create upload endpoint**

Create `app/api/upload/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getDb } from "@/lib/db";
import { generateToken, hashToken, getTokenPrefix } from "@/lib/auth";
import { parseWidgetMetadata, isEncrypted } from "@/lib/parser";
import { saveModule } from "@/lib/storage";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    const token = formData.get("token") as string | null;
    const collectionTitle = (formData.get("title") as string) || "My Widgets";
    const collectionDesc =
      (formData.get("description") as string) || "";

    if (!files.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    // Validate files
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File ${file.name} exceeds 5MB limit` },
          { status: 413 }
        );
      }
      if (!file.name.endsWith(".js")) {
        return NextResponse.json(
          { error: `File ${file.name} is not a .js file` },
          { status: 400 }
        );
      }
    }

    const db = getDb();
    let userId: string;
    let rawToken: string;
    let isNewUser = false;

    if (token) {
      // Existing user
      const hash = hashToken(token);
      const user = db
        .prepare("SELECT id FROM users WHERE token_hash = ?")
        .get(hash) as { id: string } | undefined;
      if (!user) {
        return NextResponse.json({ error: "Invalid token" }, { status: 401 });
      }
      userId = user.id;
      rawToken = token;
    } else {
      // New user
      userId = nanoid();
      rawToken = generateToken();
      const hash = hashToken(rawToken);
      const prefix = getTokenPrefix(rawToken);
      db.prepare(
        "INSERT INTO users (id, token_hash, token_prefix) VALUES (?, ?, ?)"
      ).run(userId, hash, prefix);
      isNewUser = true;
    }

    // Create or use collection
    let collectionId: string;
    let slug: string;

    const existingCollection = formData.get("collection_id") as string | null;
    if (existingCollection) {
      // Verify ownership
      const col = db
        .prepare(
          "SELECT id, slug FROM collections WHERE id = ? AND user_id = ?"
        )
        .get(existingCollection, userId) as
        | { id: string; slug: string }
        | undefined;
      if (!col) {
        return NextResponse.json(
          { error: "Collection not found or not owned" },
          { status: 404 }
        );
      }
      collectionId = col.id;
      slug = col.slug;
    } else {
      collectionId = nanoid();
      slug = nanoid(10);
      db.prepare(
        "INSERT INTO collections (id, user_id, slug, title, description) VALUES (?, ?, ?, ?, ?)"
      ).run(collectionId, userId, slug, collectionTitle, collectionDesc);
    }

    // Process and save each file
    const savedModules = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const encrypted = isEncrypted(buffer);
      const content = buffer.toString("utf8");
      const meta = encrypted ? null : parseWidgetMetadata(content);

      const moduleId = nanoid();
      const filename = file.name;

      db.prepare(
        `INSERT INTO modules (id, collection_id, filename, widget_id, title, description, version, author, file_size, is_encrypted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        moduleId,
        collectionId,
        filename,
        meta?.id || null,
        meta?.title || filename.replace(".js", ""),
        meta?.description || "",
        meta?.version || null,
        meta?.author || null,
        file.size,
        encrypted ? 1 : 0
      );

      saveModule(collectionId, filename, buffer);

      savedModules.push({
        id: moduleId,
        filename,
        title: meta?.title || filename,
        version: meta?.version,
        encrypted,
      });
    }

    const siteUrl = process.env.SITE_URL || request.nextUrl.origin;

    return NextResponse.json({
      ...(isNewUser ? { token: rawToken } : {}),
      manageUrl: `${siteUrl}/manage/${rawToken}`,
      collection: {
        id: collectionId,
        slug,
        fwdUrl: `${siteUrl}/api/collections/${slug}/fwd`,
        pageUrl: `${siteUrl}/c/${slug}`,
      },
      modules: savedModules,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

**Step 2: Commit**

```bash
git add app/api/upload/
git commit -m "feat: add upload API with metadata parsing and token creation"
```

---

### Task 7: Collection & Module APIs

**Files:**
- Create: `app/api/collections/[slug]/route.ts`
- Create: `app/api/collections/[slug]/fwd/route.ts`
- Create: `app/api/collections/[id]/upload/route.ts`
- Create: `app/api/modules/[id]/raw/route.ts`
- Create: `app/api/modules/[id]/route.ts`
- Create: `app/api/manage/route.ts`

**Step 1: Collection info endpoint**

Create `app/api/collections/[slug]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const db = getDb();

  const collection = db
    .prepare("SELECT * FROM collections WHERE slug = ?")
    .get(slug) as Record<string, unknown> | undefined;

  if (!collection) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const modules = db
    .prepare(
      "SELECT id, filename, widget_id, title, description, version, author, file_size, is_encrypted FROM modules WHERE collection_id = ? ORDER BY created_at"
    )
    .all(collection.id);

  return NextResponse.json({ collection, modules });
}
```

**Step 2: .fwd index endpoint**

Create `app/api/collections/[slug]/fwd/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface ModuleRow {
  id: string;
  filename: string;
  widget_id: string | null;
  title: string | null;
  description: string | null;
  version: string | null;
  author: string | null;
  file_size: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const db = getDb();

  const collection = db
    .prepare("SELECT * FROM collections WHERE slug = ?")
    .get(slug) as Record<string, unknown> | undefined;

  if (!collection) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const modules = db
    .prepare(
      "SELECT id, filename, widget_id, title, description, version, author, file_size FROM modules WHERE collection_id = ? ORDER BY created_at"
    )
    .all(collection.id) as ModuleRow[];

  const siteUrl = process.env.SITE_URL || request.nextUrl.origin;

  const fwd = {
    title: collection.title,
    description: collection.description,
    icon: collection.icon_url || "",
    widgets: modules.map((m) => ({
      id: m.widget_id || m.id,
      title: m.title || m.filename,
      description: m.description || "",
      version: m.version || "1.0.0",
      author: m.author || "",
      url: `${siteUrl}/api/modules/${m.id}/raw`,
    })),
  };

  return NextResponse.json(fwd);
}
```

**Step 3: Module raw download endpoint**

Create `app/api/modules/[id]/raw/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readModule } from "@/lib/storage";

interface ModuleRow {
  id: string;
  collection_id: string;
  filename: string;
  is_encrypted: number;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  const mod = db
    .prepare("SELECT id, collection_id, filename, is_encrypted FROM modules WHERE id = ?")
    .get(id) as ModuleRow | undefined;

  if (!mod) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const content = readModule(mod.collection_id, mod.filename);
  if (!content) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const contentType = mod.is_encrypted
    ? "application/octet-stream"
    : "application/javascript; charset=utf-8";

  return new NextResponse(content, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${mod.filename}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
```

**Step 4: Module CRUD endpoint**

Create `app/api/modules/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { extractToken, authenticateToken, checkRateLimit } from "@/lib/auth";
import { deleteModule as deleteModuleFile } from "@/lib/storage";

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } }
    );
  }

  const token = extractToken(request);
  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 401 });
  }
  const auth = authenticateToken(token);
  if (!auth) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();

  // Verify ownership: module -> collection -> user
  const mod = db
    .prepare(
      `SELECT m.id, m.collection_id, m.filename, c.user_id
       FROM modules m JOIN collections c ON m.collection_id = c.id
       WHERE m.id = ?`
    )
    .get(id) as
    | { id: string; collection_id: string; filename: string; user_id: string }
    | undefined;

  if (!mod || mod.user_id !== auth.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  db.prepare("DELETE FROM modules WHERE id = ?").run(id);
  deleteModuleFile(mod.collection_id, mod.filename);

  return NextResponse.json({ success: true });
}
```

**Step 5: Manage endpoint (list user's collections)**

Create `app/api/manage/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { extractToken, authenticateToken, checkRateLimit } from "@/lib/auth";

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } }
    );
  }

  const token = extractToken(request);
  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 401 });
  }
  const auth = authenticateToken(token);
  if (!auth) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const db = getDb();
  const collections = db
    .prepare("SELECT * FROM collections WHERE user_id = ? ORDER BY created_at DESC")
    .all(auth.userId);

  const siteUrl = process.env.SITE_URL || request.nextUrl.origin;

  const result = collections.map((col: Record<string, unknown>) => {
    const modules = db
      .prepare(
        "SELECT id, filename, widget_id, title, description, version, author, file_size, is_encrypted, created_at FROM modules WHERE collection_id = ? ORDER BY created_at"
      )
      .all(col.id);

    return {
      ...col,
      fwdUrl: `${siteUrl}/api/collections/${col.slug}/fwd`,
      pageUrl: `${siteUrl}/c/${col.slug}`,
      modules,
    };
  });

  return NextResponse.json({ collections: result });
}
```

**Step 6: Commit**

```bash
git add app/api/
git commit -m "feat: add collection, module, and manage API endpoints"
```

---

### Task 8: Frontend - Landing Page with Upload

**Files:**
- Create: `app/page.tsx`
- Create: `components/upload-zone.tsx`
- Create: `components/upload-result.tsx`
- Create: `lib/constants.ts`

**Step 1: Create constants**

Create `lib/constants.ts`:

```typescript
export const APP_NAME = "Forward Widget Hub";
export const APP_DESCRIPTION =
  "Upload and host your ForwardWidget modules. Get a shareable link for Forward App.";
```

**Step 2: Create upload zone component**

Create `components/upload-zone.tsx`:

```tsx
"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface UploadResult {
  token?: string;
  manageUrl: string;
  collection: {
    id: string;
    slug: string;
    fwdUrl: string;
    pageUrl: string;
  };
  modules: Array<{
    id: string;
    filename: string;
    title: string;
    version?: string;
    encrypted: boolean;
  }>;
}

interface UploadZoneProps {
  onUploadComplete: (result: UploadResult) => void;
}

export function UploadZone({ onUploadComplete }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.endsWith(".js")
    );
    if (droppedFiles.length) {
      setFiles((prev) => [...prev, ...droppedFiles]);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []).filter((f) =>
      f.name.endsWith(".js")
    );
    if (selected.length) {
      setFiles((prev) => [...prev, ...selected]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (!files.length) return;
    setIsUploading(true);

    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      if (title) formData.append("title", title);

      // Check for existing token
      const savedToken = localStorage.getItem("fwh_token");
      if (savedToken) formData.append("token", savedToken);

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      // Save token if new
      if (data.token) {
        localStorage.setItem("fwh_token", data.token);
      }

      onUploadComplete(data);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="collection-title">Collection Title (optional)</Label>
        <Input
          id="collection-title"
          placeholder="My Widgets"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1"
        />
      </div>

      <Card
        className={`border-2 border-dashed p-12 text-center cursor-pointer transition-colors ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => document.getElementById("file-input")?.click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".js"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <div className="space-y-2">
          <p className="text-lg font-medium">
            Drop .js widget files here
          </p>
          <p className="text-sm text-muted-foreground">
            or click to browse
          </p>
        </div>
      </Card>

      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {files.length} file(s) selected:
          </p>
          {files.map((file, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span>{file.name}</span>
              <button
                onClick={() => removeFile(i)}
                className="text-muted-foreground hover:text-destructive"
              >
                ✕
              </button>
            </div>
          ))}

          <Button
            onClick={handleUpload}
            disabled={isUploading}
            className="w-full"
          >
            {isUploading ? "Uploading..." : "Upload"}
          </Button>
        </div>
      )}
    </div>
  );
}
```

**Step 3: Create upload result component**

Create `components/upload-result.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface UploadResultProps {
  result: {
    token?: string;
    manageUrl: string;
    collection: {
      slug: string;
      fwdUrl: string;
      pageUrl: string;
    };
    modules: Array<{
      id: string;
      filename: string;
      title: string;
      version?: string;
      encrypted: boolean;
    }>;
  };
  onReset: () => void;
}

export function UploadResult({ result, onReset }: UploadResultProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
        <h3 className="font-semibold text-green-600">Upload Successful!</h3>
      </div>

      {result.token && (
        <Card className="border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
          <h4 className="font-semibold text-amber-600">
            ⚠ Save Your Management Token
          </h4>
          <p className="text-sm text-muted-foreground">
            This token is your only way to manage your modules. Save it now!
          </p>
          <div className="flex gap-2">
            <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono break-all">
              {result.token}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copy(result.token!, "token")}
            >
              {copied === "token" ? "Copied!" : "Copy"}
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <h4 className="font-semibold">Management Link</h4>
        <div className="flex gap-2">
          <code className="flex-1 rounded bg-muted px-3 py-2 text-sm break-all">
            {result.manageUrl}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy(result.manageUrl, "manage")}
          >
            {copied === "manage" ? "Copied!" : "Copy"}
          </Button>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <h4 className="font-semibold">Forward App Subscription Link</h4>
        <p className="text-sm text-muted-foreground">
          Share this link to import modules in Forward App
        </p>
        <div className="flex gap-2">
          <code className="flex-1 rounded bg-muted px-3 py-2 text-sm break-all">
            {result.collection.fwdUrl}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy(result.collection.fwdUrl, "fwd")}
          >
            {copied === "fwd" ? "Copied!" : "Copy"}
          </Button>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <h4 className="font-semibold">Uploaded Modules</h4>
        {result.modules.map((mod) => (
          <div
            key={mod.id}
            className="flex items-center justify-between border-b pb-2 last:border-0"
          >
            <div>
              <span className="font-medium">{mod.title}</span>
              <span className="text-sm text-muted-foreground ml-2">
                {mod.filename}
              </span>
            </div>
            <div className="flex gap-2">
              {mod.version && (
                <Badge variant="secondary">{mod.version}</Badge>
              )}
              {mod.encrypted && (
                <Badge variant="outline">Encrypted</Badge>
              )}
            </div>
          </div>
        ))}
      </Card>

      <Button variant="outline" onClick={onReset} className="w-full">
        Upload More
      </Button>
    </div>
  );
}
```

**Step 4: Update landing page**

Overwrite `app/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { UploadZone } from "@/components/upload-zone";
import { UploadResult } from "@/components/upload-result";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/constants";

export default function Home() {
  const [result, setResult] = useState<any>(null);

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight">{APP_NAME}</h1>
          <p className="mt-3 text-lg text-muted-foreground">
            {APP_DESCRIPTION}
          </p>
        </div>

        {result ? (
          <UploadResult result={result} onReset={() => setResult(null)} />
        ) : (
          <UploadZone onUploadComplete={setResult} />
        )}

        <div className="mt-16 text-center text-sm text-muted-foreground space-y-2">
          <p>
            Upload your <code>.js</code> ForwardWidget modules to get a
            hosted <code>.fwd</code> subscription link.
          </p>
          <p>
            Import the link in{" "}
            <a
              href="https://apps.apple.com/app/forward/id1490153115"
              className="underline hover:text-foreground"
              target="_blank"
              rel="noopener"
            >
              Forward App
            </a>{" "}
            to use your widgets.
          </p>
        </div>
      </div>
    </main>
  );
}
```

**Step 5: Commit**

```bash
git add app/page.tsx components/ lib/constants.ts
git commit -m "feat: add landing page with upload zone and result display"
```

---

### Task 9: Frontend - Management Page

**Files:**
- Create: `app/manage/[token]/page.tsx`
- Create: `components/collection-card.tsx`

**Step 1: Create collection card component**

Create `components/collection-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Module {
  id: string;
  filename: string;
  title: string;
  description: string;
  version: string;
  author: string;
  file_size: number;
  is_encrypted: number;
}

interface Collection {
  id: string;
  slug: string;
  title: string;
  description: string;
  fwdUrl: string;
  pageUrl: string;
  modules: Module[];
}

interface CollectionCardProps {
  collection: Collection;
  token: string;
  onModuleDeleted: () => void;
  onModulesUploaded: () => void;
}

export function CollectionCard({
  collection,
  token,
  onModuleDeleted,
  onModulesUploaded,
}: CollectionCardProps) {
  const [copied, setCopied] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async (moduleId: string) => {
    if (!confirm("Delete this module?")) return;
    const res = await fetch(`/api/modules/${moduleId}?token=${token}`, {
      method: "DELETE",
    });
    if (res.ok) onModuleDeleted();
  };

  const handleUploadMore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setIsUploading(true);

    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      formData.append("token", token);
      formData.append("collection_id", collection.id);

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (res.ok) onModulesUploaded();
    } finally {
      setIsUploading(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">{collection.title}</h3>
          {collection.description && (
            <p className="text-sm text-muted-foreground">
              {collection.description}
            </p>
          )}
        </div>
        <Badge variant="outline">{collection.modules.length} modules</Badge>
      </div>

      <div className="rounded-md bg-muted px-3 py-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">FWD Link:</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => copy(collection.fwdUrl)}
          >
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
        <code className="break-all text-xs">{collection.fwdUrl}</code>
      </div>

      <div className="divide-y">
        {collection.modules.map((mod) => (
          <div key={mod.id} className="flex items-center justify-between py-2">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{mod.title}</span>
                {mod.version && (
                  <Badge variant="secondary" className="text-xs">
                    {mod.version}
                  </Badge>
                )}
                {mod.is_encrypted ? (
                  <Badge variant="outline" className="text-xs">
                    Encrypted
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {mod.filename} · {formatSize(mod.file_size)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => handleDelete(mod.id)}
            >
              Delete
            </Button>
          </div>
        ))}
      </div>

      <div>
        <input
          type="file"
          accept=".js"
          multiple
          className="hidden"
          id={`upload-${collection.id}`}
          onChange={handleUploadMore}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={isUploading}
          onClick={() =>
            document.getElementById(`upload-${collection.id}`)?.click()
          }
        >
          {isUploading ? "Uploading..." : "Add Modules"}
        </Button>
      </div>
    </Card>
  );
}
```

**Step 2: Create management page**

Create `app/manage/[token]/page.tsx`:

```tsx
"use client";

import { useEffect, useState, useCallback, use } from "react";
import { CollectionCard } from "@/components/collection-card";
import { APP_NAME } from "@/lib/constants";

interface ManagePageProps {
  params: Promise<{ token: string }>;
}

export default function ManagePage({ params }: ManagePageProps) {
  const { token } = use(params);
  const [collections, setCollections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCollections = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/manage?token=${token}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCollections(data.collections);
      // Save token to localStorage
      localStorage.setItem("fwh_token", token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-destructive font-medium">Error: {error}</p>
          <p className="text-sm text-muted-foreground">
            Make sure your management link is correct.
          </p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="mb-8">
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← {APP_NAME}
          </a>
          <h1 className="text-3xl font-bold tracking-tight mt-2">
            My Collections
          </h1>
        </div>

        <div className="space-y-6">
          {collections.map((col) => (
            <CollectionCard
              key={col.id}
              collection={col}
              token={token}
              onModuleDeleted={fetchCollections}
              onModulesUploaded={fetchCollections}
            />
          ))}

          {collections.length === 0 && (
            <p className="text-center text-muted-foreground py-8">
              No collections yet.{" "}
              <a href="/" className="underline">
                Upload some modules
              </a>
              .
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
```

**Step 3: Commit**

```bash
git add app/manage/ components/collection-card.tsx
git commit -m "feat: add management page with collection cards"
```

---

### Task 10: Frontend - Collection Public Page

**Files:**
- Create: `app/c/[slug]/page.tsx`

**Step 1: Create collection public page**

Create `app/c/[slug]/page.tsx`:

```tsx
import { getDb } from "@/lib/db";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { APP_NAME } from "@/lib/constants";

interface Module {
  id: string;
  filename: string;
  title: string;
  description: string;
  version: string;
  author: string;
  file_size: number;
  is_encrypted: number;
}

// This is a server component
export default async function CollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const db = getDb();

  const collection = db
    .prepare("SELECT * FROM collections WHERE slug = ?")
    .get(slug) as Record<string, any> | undefined;

  if (!collection) notFound();

  const modules = db
    .prepare(
      "SELECT * FROM modules WHERE collection_id = ? ORDER BY created_at"
    )
    .all(collection.id) as Module[];

  const siteUrl = process.env.SITE_URL || "";
  const fwdUrl = `${siteUrl}/api/collections/${slug}/fwd`;

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="mb-8">
          <a
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← {APP_NAME}
          </a>
        </div>

        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {collection.title}
            </h1>
            {collection.description && (
              <p className="mt-2 text-muted-foreground">
                {collection.description}
              </p>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              {modules.length} module(s)
            </p>
          </div>

          <CopyFwdLink url={fwdUrl} />

          <div className="divide-y rounded-lg border">
            {modules.map((mod) => (
              <div key={mod.id} className="p-4">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{mod.title}</span>
                  {mod.version && (
                    <Badge variant="secondary">{mod.version}</Badge>
                  )}
                  {mod.is_encrypted ? (
                    <Badge variant="outline">Encrypted</Badge>
                  ) : null}
                </div>
                {mod.description && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {mod.description}
                  </p>
                )}
                {mod.author && (
                  <p className="text-xs text-muted-foreground mt-1">
                    by {mod.author}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

// Client component for copy button
function CopyFwdLink({ url }: { url: string }) {
  return (
    <div className="rounded-md bg-muted p-4 space-y-2">
      <p className="text-sm font-medium">Import in Forward App:</p>
      <div className="flex gap-2">
        <code className="flex-1 rounded bg-background px-3 py-2 text-sm break-all border">
          {url}
        </code>
      </div>
      <p className="text-xs text-muted-foreground">
        Copy this link and add it as a subscription source in Forward App
      </p>
    </div>
  );
}
```

Note: The CopyFwdLink should be extracted as a client component with "use client" for the copy button to work. For simplicity, render the URL without a copy button in the server component, or extract a small client component. Let the implementer decide the cleanest approach.

**Step 2: Commit**

```bash
git add app/c/
git commit -m "feat: add collection public page"
```

---

### Task 11: Layout & Theme

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

**Step 1: Update layout with dark mode support and metadata**

Update `app/layout.tsx` to include:
- App metadata (title, description)
- Dark mode support via `className="dark"` or system preference
- Consistent container styling
- Sonner toast provider for notifications

**Step 2: Ensure globals.css has clean base styles**

The shadcn init should have set up Tailwind v4 properly. Verify it works.

**Step 3: Commit**

```bash
git add app/layout.tsx app/globals.css
git commit -m "feat: update layout with metadata and theme support"
```

---

### Task 12: Docker Setup

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

**Step 1: Create .dockerignore**

Create `.dockerignore`:

```
node_modules
.next
.git
data
docs
*.md
```

**Step 2: Create Dockerfile**

Create `Dockerfile`:

```dockerfile
FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

RUN mkdir -p /data && chown nextjs:nodejs /data

USER nextjs
VOLUME ["/data"]
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
```

**Step 3: Create docker-compose.yml**

Create `docker-compose.yml`:

```yaml
services:
  forward-widget-hub:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    environment:
      - SITE_URL=http://localhost:3000
    restart: unless-stopped
```

**Step 4: Test Docker build**

```bash
docker build -t forward-widget-hub .
docker run -d -p 3000:3000 -v $(pwd)/data:/data forward-widget-hub
```

Verify the app loads at http://localhost:3000

**Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "feat: add Docker setup with multi-stage build"
```

---

### Task 13: README

**Files:**
- Create: `README.md`

**Step 1: Write README**

Create `README.md` with:
- Project name and description
- Features list
- Quick start (Docker one-liner)
- docker-compose setup
- Environment variables table (SITE_URL, DATA_DIR)
- Development setup (npm install, npm run dev)
- API documentation summary
- How to import in Forward App
- License (MIT)

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and usage instructions"
```

---

### Task 14: Testing & Polish

**Step 1: Manual end-to-end test**

1. Start dev server: `npm run dev`
2. Open http://localhost:3000
3. Upload a sample .js widget file (use one from ForwardWidgetsOfficial/widgets/)
4. Verify token and links are displayed
5. Visit management link
6. Verify module list shows up
7. Visit collection public page
8. Verify .fwd endpoint returns correct JSON
9. Verify raw module download works
10. Upload additional module to existing collection
11. Delete a module
12. Test with encrypted module file

**Step 2: Fix any issues found during testing**

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: polish and fix issues from testing"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Project scaffold | package.json, next.config.ts |
| 2 | Database layer | lib/db.ts, lib/db-schema.ts |
| 3 | Token & auth | lib/auth.ts |
| 4 | Metadata parser | lib/parser.ts |
| 5 | File storage | lib/storage.ts |
| 6 | Upload API | app/api/upload/route.ts |
| 7 | Collection & Module APIs | app/api/collections/, app/api/modules/, app/api/manage/ |
| 8 | Landing page + upload UI | app/page.tsx, components/upload-*.tsx |
| 9 | Management page | app/manage/[token]/page.tsx |
| 10 | Collection public page | app/c/[slug]/page.tsx |
| 11 | Layout & theme | app/layout.tsx |
| 12 | Docker setup | Dockerfile, docker-compose.yml |
| 13 | README | README.md |
| 14 | Testing & polish | — |
