import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getBackendDb, getBackendStore } from "@/lib/backend";
import { generateToken, hashToken, getTokenPrefix } from "@/lib/auth";
import { parseWidgetMetadata, isEncrypted } from "@/lib/parser";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const DOWNLOAD_TIMEOUT = 30_000; // 30s per remote file

interface FwdWidget {
  id?: string;
  title?: string;
  description?: string;
  version?: string;
  author?: string;
  requiredVersion?: string;
  url: string;
}

interface FwdIndex {
  title?: string;
  description?: string;
  icon?: string;
  widgets: FwdWidget[];
}

type ModuleInfo = { id: string; filename: string; title: string; version?: string; encrypted: boolean; source_url?: string };

async function downloadRemoteJs(url: string): Promise<{ buffer: Buffer; filename: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Forward" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_FILE_SIZE) throw new Error("Remote file exceeds 5MB limit");
    const urlPath = new URL(url).pathname;
    let filename = urlPath.split("/").pop() || "widget.js";
    if (!filename.endsWith(".js")) filename += ".js";
    return { buffer: buf, filename };
  } finally {
    clearTimeout(timeout);
  }
}

function parseFwdFile(content: string): FwdIndex {
  const parsed = JSON.parse(content);
  if (!parsed.widgets || !Array.isArray(parsed.widgets)) {
    throw new Error("Invalid .fwd format: missing widgets array");
  }
  for (const w of parsed.widgets) {
    if (!w.url || typeof w.url !== "string") {
      throw new Error("Invalid .fwd format: widget missing url");
    }
  }
  return parsed as FwdIndex;
}

async function downloadRemoteFile(url: string): Promise<{ buffer: Buffer; filename: string; isFwd: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Forward" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_FILE_SIZE) throw new Error("Remote file exceeds 5MB limit");
    const urlPath = new URL(url).pathname;
    let filename = urlPath.split("/").pop() || "widget.js";
    const isFwd = filename.endsWith(".fwd") || (() => {
      try { const j = JSON.parse(buf.toString("utf8")); return Array.isArray(j.widgets); } catch { return false; }
    })();
    if (!isFwd && !filename.endsWith(".js")) filename += ".js";
    return { buffer: buf, filename, isFwd };
  } finally {
    clearTimeout(timeout);
  }
}

function createProgressStream(
  fn: (send: (event: Record<string, unknown>) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      try {
        await fn(send);
      } catch (e) {
        send({ type: "error", error: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/x-ndjson", "Cache-Control": "no-cache" },
  });
}

async function downloadAndStoreIcon(
  iconUrl: string,
  collectionId: string,
  slug: string,
  siteUrl: string,
  store: Awaited<ReturnType<typeof getBackendStore>>,
): Promise<string> {
  if (!iconUrl) return "";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(iconUrl, { signal: controller.signal, headers: { "User-Agent": "Forward" } });
      if (!res.ok) return iconUrl;
      const contentType = res.headers.get("content-type") || "image/jpeg";
      const ext = contentType.includes("png") ? "png"
        : contentType.includes("gif") ? "gif"
        : contentType.includes("webp") ? "webp"
        : contentType.includes("svg") ? "svg"
        : "jpg";
      const buf = Buffer.from(await res.arrayBuffer());
      const iconFilename = `_icon.${ext}`;
      const savedKey = await store.save(collectionId, iconFilename, buf);
      const actualKey = savedKey || iconFilename;
      const cdnUrl = store.getUrl?.(collectionId, actualKey);
      return cdnUrl || `${siteUrl}/api/collections/${slug}/icon`;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return iconUrl; // fallback to original URL
  }
}

async function downloadAndStoreWidget(
  widget: FwdWidget,
  collectionId: string,
  db: Awaited<ReturnType<typeof getBackendDb>>,
  store: Awaited<ReturnType<typeof getBackendStore>>,
  widgetSourceUrl?: string,
): Promise<ModuleInfo> {
  const dl = await downloadRemoteJs(widget.url);
  const encrypted = isEncrypted(dl.buffer);
  const meta = encrypted ? null : parseWidgetMetadata(dl.buffer.toString("utf8"));
  const moduleId = nanoid();
  const srcUrl = widgetSourceUrl || widget.url;
  await db.prepare(
    `INSERT INTO modules (id, collection_id, filename, widget_id, title, description, version, author, required_version, file_size, is_encrypted, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    moduleId, collectionId, dl.filename,
    widget.id || meta?.id || null,
    widget.title || meta?.title || dl.filename.replace(".js", ""),
    widget.description || meta?.description || "",
    widget.version || meta?.version || null,
    widget.author || meta?.author || null,
    widget.requiredVersion || meta?.requiredVersion || null,
    dl.buffer.length, encrypted ? 1 : 0,
    srcUrl
  );
  const ossKey = await store.save(collectionId, dl.filename, dl.buffer);
  if (ossKey) await db.prepare("UPDATE modules SET oss_key = ? WHERE id = ?").run(ossKey, moduleId);
  return {
    id: moduleId,
    filename: dl.filename,
    title: widget.title || meta?.title || dl.filename,
    version: widget.version || meta?.version,
    encrypted,
    source_url: srcUrl,
  };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    const remoteUrl = formData.get("url") as string | null;
    const token = formData.get("token") as string | null;
    const collectionTitle = (formData.get("title") as string) || "My Widgets";
    const collectionDesc = (formData.get("description") as string) || "";
    const collectionIcon = (formData.get("icon") as string) || "";
    const widgetMetaRaw = formData.get("widget_meta") as string | null;
    const sourceUrl = formData.get("source_url") as string | null;
    const syncMode = formData.get("sync") === "true";
    const syncCollectionId = syncMode ? (formData.get("collection_id") as string | null) : null;
    let widgetMeta: Array<{ id?: string; title?: string; description?: string; version?: string; author?: string; requiredVersion?: string; source_url?: string }> | null = null;
    if (widgetMetaRaw) {
      try {
        widgetMeta = JSON.parse(widgetMetaRaw);
      } catch {
        return NextResponse.json({ error: "Invalid widget_meta format" }, { status: 400 });
      }
    }

    if (!files.length && !remoteUrl) {
      return NextResponse.json({ error: "No files or URL provided" }, { status: 400 });
    }

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `File ${file.name} exceeds 5MB limit` }, { status: 413 });
      }
      if (!file.name.endsWith(".js") && !file.name.endsWith(".fwd")) {
        return NextResponse.json({ error: `File ${file.name} must be .js or .fwd` }, { status: 400 });
      }
    }

    const db = await getBackendDb();
    const store = await getBackendStore();
    let userId: string;
    let rawToken: string;
    let isNewUser = false;

    if (token) {
      const hash = hashToken(token);
      const user = await db.prepare("SELECT id FROM users WHERE token_hash = ?").get(hash) as { id: string } | undefined;
      if (!user) {
        return NextResponse.json({ error: "Invalid token" }, { status: 401 });
      }
      userId = user.id;
      rawToken = token;
    } else {
      userId = nanoid();
      rawToken = generateToken();
      const hash = hashToken(rawToken);
      const prefix = getTokenPrefix(rawToken);
      await db.prepare("INSERT INTO users (id, token_hash, token_prefix) VALUES (?, ?, ?)").run(userId, hash, prefix);
      isNewUser = true;
    }

    const proto = request.headers.get("x-forwarded-proto") || "https";
    const host = request.headers.get("host") || request.nextUrl.host;
    const siteUrl = `${proto}://${host}`;
    const resultBase = { ...(isNewUser ? { token: rawToken } : {}), manageUrl: `${siteUrl}/manage/${rawToken}` };

    // Handle remote URL
    if (remoteUrl) {
      let downloaded: Awaited<ReturnType<typeof downloadRemoteFile>>;
      try {
        downloaded = await downloadRemoteFile(remoteUrl);
      } catch (e) {
        return NextResponse.json({ error: `Failed to download: ${(e as Error).message}` }, { status: 400 });
      }

      if (downloaded.isFwd) {
        let fwd: FwdIndex;
        try {
          fwd = parseFwdFile(downloaded.buffer.toString("utf8"));
        } catch (e) {
          return NextResponse.json({ error: `Invalid .fwd content: ${(e as Error).message}` }, { status: 400 });
        }

        const collectionId = nanoid();
        const slug = nanoid(10);
        const iconUrl = fwd.icon ? await downloadAndStoreIcon(fwd.icon, collectionId, slug, siteUrl, store) : "";
        await db.prepare(
          "INSERT INTO collections (id, user_id, slug, title, description, icon_url, source_url) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(collectionId, userId, slug, fwd.title || downloaded.filename, fwd.description || "", iconUrl, remoteUrl);
        const fwdUrl = `${siteUrl}/api/collections/${slug}/fwd`;

        return createProgressStream(async (send) => {
          const allModules: ModuleInfo[] = [];
          for (let i = 0; i < fwd.widgets.length; i++) {
            const widget = fwd.widgets[i];
            const fname = widget.url.split("/").pop() || "widget.js";
            send({ type: "progress", current: i + 1, total: fwd.widgets.length, filename: fname });
            const mod = await downloadAndStoreWidget(widget, collectionId, db, store, widget.url);
            allModules.push(mod);
          }
          send({ type: "result", ...resultBase, fwdUrl, modules: allModules });
        });
      }

      // Non-.fwd remote: single .js file
      const { buffer, filename } = downloaded;
      const encrypted = isEncrypted(buffer);
      const meta = encrypted ? null : parseWidgetMetadata(buffer.toString("utf8"));
      const collectionId = nanoid();
      const slug = nanoid(10);
      await db.prepare("INSERT INTO collections (id, user_id, slug, title, description) VALUES (?, ?, ?, ?, ?)").run(collectionId, userId, slug, meta?.title || filename.replace(".js", ""), meta?.description || "");
      const fwdUrl = `${siteUrl}/api/collections/${slug}/fwd`;
      const moduleId = nanoid();
      await db.prepare(
        `INSERT INTO modules (id, collection_id, filename, widget_id, title, description, version, author, required_version, file_size, is_encrypted, source_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(moduleId, collectionId, filename, meta?.id || null, meta?.title || filename.replace(".js", ""), meta?.description || "", meta?.version || null, meta?.author || null, meta?.requiredVersion || null, buffer.length, encrypted ? 1 : 0, remoteUrl);
      const ossKey = await store.save(collectionId, filename, buffer);
      if (ossKey) await db.prepare("UPDATE modules SET oss_key = ? WHERE id = ?").run(ossKey, moduleId);

      return NextResponse.json({
        ...resultBase, fwdUrl,
        modules: [{ id: moduleId, filename, title: meta?.title || filename, version: meta?.version, encrypted }],
      });
    }

    // Separate .fwd and .js files
    const fwdFiles = files.filter((f) => f.name.endsWith(".fwd"));
    const jsFiles = files.filter((f) => f.name.endsWith(".js"));

    // If has .fwd files, use streaming response
    if (fwdFiles.length > 0) {
      // Pre-parse all .fwd files for validation and total count
      const parsedFwds: { file: File; fwd: FwdIndex }[] = [];
      let totalWidgets = 0;
      for (const file of fwdFiles) {
        const content = await file.text();
        let fwd: FwdIndex;
        try {
          fwd = parseFwdFile(content);
        } catch (e) {
          return NextResponse.json({ error: `Invalid .fwd file: ${(e as Error).message}` }, { status: 400 });
        }
        parsedFwds.push({ file, fwd });
        totalWidgets += fwd.widgets.length;
      }

      return createProgressStream(async (send) => {
        const allModules: ModuleInfo[] = [];
        let fwdUrl: string | undefined;
        let currentWidget = 0;

        for (const { file, fwd } of parsedFwds) {
          const collectionId = nanoid();
          const slug = nanoid(10);
          const iconUrl = fwd.icon ? await downloadAndStoreIcon(fwd.icon, collectionId, slug, siteUrl, store) : "";
          await db.prepare(
            "INSERT INTO collections (id, user_id, slug, title, description, icon_url, source_url) VALUES (?, ?, ?, ?, ?, ?, ?)"
          ).run(collectionId, userId, slug, fwd.title || file.name, fwd.description || "", iconUrl, sourceUrl || null);
          fwdUrl = `${siteUrl}/api/collections/${slug}/fwd`;

          for (const widget of fwd.widgets) {
            currentWidget++;
            const fname = widget.url.split("/").pop() || "widget.js";
            send({ type: "progress", current: currentWidget, total: totalWidgets, filename: fname });
            const mod = await downloadAndStoreWidget(widget, collectionId, db, store, widget.url);
            allModules.push(mod);
          }
        }

        // Also process .js files if any
        if (jsFiles.length > 0) {
          const existingCollection = formData.get("collection_id") as string | null;
          let collectionId: string;
          if (existingCollection) {
            const col = await db.prepare("SELECT id, slug FROM collections WHERE id = ? AND user_id = ?").get(existingCollection, userId) as { id: string; slug: string } | undefined;
            if (!col) throw new Error("Collection not found or not owned");
            collectionId = col.id;
          } else {
            collectionId = nanoid();
            const slug = nanoid(10);
            await db.prepare("INSERT INTO collections (id, user_id, slug, title, description) VALUES (?, ?, ?, ?, ?)").run(collectionId, userId, slug, collectionTitle, collectionDesc);
          }
          for (let ji = 0; ji < jsFiles.length; ji++) {
            const file = jsFiles[ji];
            const buffer = Buffer.from(await file.arrayBuffer());
            const encrypted = isEncrypted(buffer);
            const meta = encrypted ? null : parseWidgetMetadata(buffer.toString("utf8"));
            const wm = widgetMeta?.[ji];
            const moduleId = nanoid();
            await db.prepare(
              `INSERT INTO modules (id, collection_id, filename, widget_id, title, description, version, author, required_version, file_size, is_encrypted, source_url)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(moduleId, collectionId, file.name, meta?.id || null, meta?.title || file.name.replace(".js", ""), meta?.description || "", meta?.version || null, meta?.author || null, meta?.requiredVersion || null, file.size, encrypted ? 1 : 0, wm?.source_url || null);
            const ossKey2 = await store.save(collectionId, file.name, buffer);
            if (ossKey2) await db.prepare("UPDATE modules SET oss_key = ? WHERE id = ?").run(ossKey2, moduleId);
            allModules.push({ id: moduleId, filename: file.name, title: meta?.title || file.name, version: meta?.version, encrypted });
          }
        }

        send({ type: "result", ...resultBase, ...(fwdUrl ? { fwdUrl } : {}), modules: allModules });
      });
    }

    // Sync mode — update existing collection modules
    if (syncMode && syncCollectionId) {
      const col = await db.prepare("SELECT id, slug FROM collections WHERE id = ? AND user_id = ?").get(syncCollectionId, userId) as { id: string; slug: string } | undefined;
      if (!col) {
        return NextResponse.json({ error: "Collection not found or not owned" }, { status: 404 });
      }
      const collectionId = col.id;

      // Update collection metadata if provided
      if (collectionTitle) {
        const storedIcon = collectionIcon ? await downloadAndStoreIcon(collectionIcon, collectionId, col.slug, siteUrl, store) : collectionIcon;
        await db.prepare("UPDATE collections SET title = ?, description = ?, icon_url = ?, source_url = COALESCE(?, source_url), updated_at = unixepoch() WHERE id = ?").run(collectionTitle, collectionDesc, storedIcon, sourceUrl, collectionId);
      }

      // Get existing modules for matching
      const existingModules = await db.prepare("SELECT id, filename, widget_id, source_url, oss_key FROM modules WHERE collection_id = ?").all(collectionId) as Array<{ id: string; filename: string; widget_id: string | null; source_url: string | null; oss_key: string | null }>;

      const allModules: ModuleInfo[] = [];
      for (let i = 0; i < jsFiles.length; i++) {
        const file = jsFiles[i];
        const buffer = Buffer.from(await file.arrayBuffer());
        const encrypted = isEncrypted(buffer);
        const content = buffer.toString("utf8");
        const meta = encrypted ? null : parseWidgetMetadata(content);
        const wm = widgetMeta?.[i];
        const wmSourceUrl = wm?.source_url || null;
        const wmWidgetId = wm?.id || meta?.id || null;
        const filename = file.name;

        // Match priority: source_url → widget_id → filename
        const matched = existingModules.find((m) =>
          (wmSourceUrl && m.source_url === wmSourceUrl) ||
          (wmWidgetId && m.widget_id === wmWidgetId) ||
          m.filename === filename
        );

        if (matched) {
          const ossKey = await store.save(collectionId, filename, buffer);
          // UPDATE existing module
          await db.prepare(
            `UPDATE modules SET filename = ?, widget_id = ?, title = ?, description = ?, version = ?, author = ?, required_version = ?, file_size = ?, is_encrypted = ?, source_url = COALESCE(?, source_url), oss_key = ?, updated_at = unixepoch() WHERE id = ?`
          ).run(filename,
            wm?.id || meta?.id || matched.widget_id,
            wm?.title || meta?.title || filename.replace(".js", ""),
            wm?.description || meta?.description || "",
            wm?.version || meta?.version || null,
            wm?.author || meta?.author || null,
            wm?.requiredVersion || meta?.requiredVersion || null,
            file.size, encrypted ? 1 : 0,
            wmSourceUrl,
            ossKey || null,
            matched.id);
          allModules.push({ id: matched.id, filename, title: wm?.title || meta?.title || filename, version: wm?.version || meta?.version, encrypted, source_url: wmSourceUrl || matched.source_url || undefined });
        } else {
          // INSERT new module
          const moduleId = nanoid();
          await db.prepare(
            `INSERT INTO modules (id, collection_id, filename, widget_id, title, description, version, author, required_version, file_size, is_encrypted, source_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(moduleId, collectionId, filename,
            wm?.id || meta?.id || null,
            wm?.title || meta?.title || filename.replace(".js", ""),
            wm?.description || meta?.description || "",
            wm?.version || meta?.version || null,
            wm?.author || meta?.author || null,
            wm?.requiredVersion || meta?.requiredVersion || null,
            file.size, encrypted ? 1 : 0,
            wmSourceUrl);
          const ossKey = await store.save(collectionId, filename, buffer);
          if (ossKey) await db.prepare("UPDATE modules SET oss_key = ? WHERE id = ?").run(ossKey, moduleId);
          allModules.push({ id: moduleId, filename, title: wm?.title || meta?.title || filename, version: wm?.version || meta?.version, encrypted, source_url: wmSourceUrl || undefined });
        }
      }

      const fwdUrl = `${siteUrl}/api/collections/${col.slug}/fwd`;
      return NextResponse.json({ ...resultBase, fwdUrl, modules: allModules, synced: true });
    }

    // Only .js files — regular JSON response
    const allModules: ModuleInfo[] = [];
    let collectionId: string;
    let collectionSlug: string;

    const existingCollection = formData.get("collection_id") as string | null;
    if (existingCollection) {
      const col = await db.prepare("SELECT id, slug FROM collections WHERE id = ? AND user_id = ?").get(existingCollection, userId) as { id: string; slug: string } | undefined;
      if (!col) {
        return NextResponse.json({ error: "Collection not found or not owned" }, { status: 404 });
      }
      collectionId = col.id;
      collectionSlug = col.slug;
    } else {
      collectionId = nanoid();
      collectionSlug = nanoid(10);
      await db.prepare("INSERT INTO collections (id, user_id, slug, title, description, icon_url) VALUES (?, ?, ?, ?, ?, ?)").run(collectionId, userId, collectionSlug, collectionTitle, collectionDesc, collectionIcon);
    }

    for (let i = 0; i < jsFiles.length; i++) {
      const file = jsFiles[i];
      const buffer = Buffer.from(await file.arrayBuffer());
      const encrypted = isEncrypted(buffer);
      const content = buffer.toString("utf8");
      const meta = encrypted ? null : parseWidgetMetadata(content);
      const wm = widgetMeta?.[i];
      const moduleId = nanoid();
      const filename = file.name;

      await db.prepare(
        `INSERT INTO modules (id, collection_id, filename, widget_id, title, description, version, author, required_version, file_size, is_encrypted, source_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(moduleId, collectionId, filename,
        wm?.id || meta?.id || null,
        wm?.title || meta?.title || filename.replace(".js", ""),
        wm?.description || meta?.description || "",
        wm?.version || meta?.version || null,
        wm?.author || meta?.author || null,
        wm?.requiredVersion || meta?.requiredVersion || null,
        file.size, encrypted ? 1 : 0,
        wm?.source_url || sourceUrl || null);

      const ossKey = await store.save(collectionId, filename, buffer);
      if (ossKey) await db.prepare("UPDATE modules SET oss_key = ? WHERE id = ?").run(ossKey, moduleId);
      allModules.push({ id: moduleId, filename, title: wm?.title || meta?.title || filename, version: wm?.version || meta?.version, encrypted });
    }

    const fwdUrl = `${siteUrl}/api/collections/${collectionSlug}/fwd`;
    return NextResponse.json({ ...resultBase, fwdUrl, modules: allModules });
  } catch (error) {
    console.error("Upload error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
