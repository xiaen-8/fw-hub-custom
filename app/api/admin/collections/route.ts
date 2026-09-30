import { NextRequest, NextResponse } from "next/server";
import { getBackendDb } from "@/lib/backend";
import { verifyAdmin } from "@/lib/admin-auth";

interface CollectionRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string;
  user_id: string;
  source_url: string;
  created_at: number;
  updated_at: number;
}

interface ModuleRow {
  id: string;
  collection_id: string;
  filename: string;
  title: string;
  version: string;
  author: string;
  file_size: number;
  is_encrypted: number;
  source_url: string;
}

export async function GET(request: NextRequest) {
  const denied = await verifyAdmin(request);
  if (denied) return denied;

  const db = await getBackendDb();

  const collections = await db
    .prepare(
      "SELECT id, slug, title, description, icon_url, user_id, source_url, created_at, updated_at FROM collections ORDER BY updated_at DESC"
    )
    .all<CollectionRow>();

  const modules = await db
    .prepare(
      "SELECT id, collection_id, filename, title, version, author, file_size, is_encrypted, source_url FROM modules ORDER BY created_at"
    )
    .all<ModuleRow>();

  const modulesByCollection = new Map<string, ModuleRow[]>();
  for (const m of modules) {
    const list = modulesByCollection.get(m.collection_id) || [];
    list.push(m);
    modulesByCollection.set(m.collection_id, list);
  }

  const result = collections.map((col) => ({
    ...col,
    modules: modulesByCollection.get(col.id) || [],
  }));

  return NextResponse.json({ collections: result });
}
