import { NextRequest, NextResponse } from "next/server";
import { getBackendDb, getBackendStore } from "@/lib/backend";
import { verifyAdmin } from "@/lib/admin-auth";
import { parseWidgetMetadata } from "@/lib/parser";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await verifyAdmin(request);
  if (denied) return denied;

  const { id } = await params;
  const db = await getBackendDb();

  const mod = (await db
    .prepare("SELECT id, collection_id, filename, oss_key FROM modules WHERE id = ?")
    .get(id)) as { id: string; collection_id: string; filename: string; oss_key: string | null } | undefined;

  if (!mod) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const store = await getBackendStore();
  const ossKey = await store.save(mod.collection_id, mod.filename, buf);

  const meta = parseWidgetMetadata(buf.toString("utf-8"));
  await db.prepare(
    "UPDATE modules SET file_size = ?, title = ?, version = ?, author = ?, description = ?, oss_key = ?, updated_at = unixepoch() WHERE id = ?"
  ).run(buf.length, meta?.title || mod.filename, meta?.version || null, meta?.author || null, meta?.description || null, ossKey || null, id);

  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await verifyAdmin(request);
  if (denied) return denied;

  const { id } = await params;
  const db = await getBackendDb();

  const mod = (await db
    .prepare("SELECT id, collection_id, filename, oss_key FROM modules WHERE id = ?")
    .get(id)) as { id: string; collection_id: string; filename: string; oss_key: string | null } | undefined;

  if (!mod) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.prepare("DELETE FROM modules WHERE id = ?").run(id);
  const store = await getBackendStore();
  await store.remove(mod.collection_id, mod.oss_key || mod.filename);

  return NextResponse.json({ success: true });
}
