import type { Store } from "../backend";

interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface R2Objects {
  objects: { key: string }[];
  truncated: boolean;
  cursor?: string;
}

interface R2Bucket {
  put(key: string, value: ArrayBuffer | Uint8Array | string): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string }): Promise<R2Objects>;
}

export function createR2Store(binding: unknown): Store {
  const bucket = binding as R2Bucket;

  return {
    async save(collectionId, filename, content) {
      const key = `${collectionId}/${filename}`;
      await bucket.put(key, content instanceof Buffer ? new Uint8Array(content) : content);
    },
    async read(collectionId, filename) {
      const key = `${collectionId}/${filename}`;
      const obj = await bucket.get(key);
      if (!obj) return null;
      return Buffer.from(await obj.arrayBuffer());
    },
    async remove(collectionId, filename) {
      await bucket.delete(`${collectionId}/${filename}`);
    },
    async removeCollection(collectionId) {
      const prefix = `${collectionId}/`;
      let cursor: string | undefined;
      do {
        const listed = await bucket.list({ prefix, cursor });
        if (listed.objects.length > 0) {
          await bucket.delete(listed.objects.map((o) => o.key));
        }
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
    },
  };
}
