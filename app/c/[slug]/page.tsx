import { getBackendDb } from "@/lib/backend";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { APP_NAME } from "@/lib/constants";
import { CopyButton } from "./copy-button";

interface Module {
  id: string; filename: string; title: string; description: string;
  version: string; author: string; file_size: number; is_encrypted: number;
}

export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getBackendDb();

  const collection = await db.prepare("SELECT * FROM collections WHERE slug = ?").get(slug) as Record<string, any> | undefined;
  if (!collection) notFound();

  const modules = await db.prepare("SELECT * FROM modules WHERE collection_id = ? ORDER BY created_at").all(collection.id) as Module[];
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("host") || "localhost";
  const fwdUrl = `${proto}://${host}/api/collections/${slug}/fwd`;

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="mb-8">
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground">&larr; {APP_NAME}</a>
        </div>
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{collection.title}</h1>
            {collection.description && <p className="mt-2 text-muted-foreground">{collection.description}</p>}
            <p className="mt-1 text-sm text-muted-foreground">{modules.length} module(s)</p>
          </div>

          <div className="rounded-md bg-muted p-4 space-y-2">
            <p className="text-sm font-medium">Import in Forward App:</p>
            <div className="flex gap-2">
              <code className="flex-1 rounded bg-background px-3 py-2 text-sm break-all border">{fwdUrl}</code>
              <CopyButton text={fwdUrl} />
            </div>
            <p className="text-xs text-muted-foreground">Copy this link and add it as a subscription source in Forward App</p>
          </div>

          <div className="divide-y rounded-lg border">
            {modules.map((mod) => (
              <div key={mod.id} className="p-4">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{mod.title}</span>
                  {mod.version && <Badge variant="secondary">{mod.version}</Badge>}
                  {mod.is_encrypted ? <Badge variant="outline">Encrypted</Badge> : null}
                </div>
                {mod.description && <p className="text-sm text-muted-foreground mt-1">{mod.description}</p>}
                {mod.author && <p className="text-xs text-muted-foreground mt-1">by {mod.author}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
