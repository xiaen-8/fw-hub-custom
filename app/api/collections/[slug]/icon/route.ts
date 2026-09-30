import { NextRequest, NextResponse } from "next/server";
import { getBackendDb, getBackendStore } from "@/lib/backend";

const ICON_EXTS = ["jpg", "png", "gif", "webp", "svg"];
const MIME: Record<string, string> = {
  jpg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml",
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getBackendDb();
  const store = await getBackendStore();

  const col = await db.prepare("SELECT id FROM collections WHERE slug = ?").get(slug) as { id: string } | undefined;
  if (!col) return new NextResponse("Not Found", { status: 404 });

  for (const ext of ICON_EXTS) {
    const buf = await store.read(col.id, `_icon.${ext}`);
    if (buf) {
      return new NextResponse(buf as unknown as BodyInit, {
        headers: {
          "Content-Type": MIME[ext],
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
  }

  return new NextResponse("Not Found", { status: 404 });
}
