import type { Store } from "../backend";
import OSS from "ali-oss";

export function createOssStore(): Store {
  const client = new OSS({
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET || "forward-image",
    region: process.env.OSS_REGION || "oss-cn-hangzhou",
  });

  const bucket = process.env.OSS_BUCKET || "forward-image";
  const region = process.env.OSS_REGION || "oss-cn-hangzhou";
  const cdnDomain = process.env.OSS_CDN_DOMAIN || `${bucket}.${region}.aliyuncs.com`;
  const prefix = "widget-hub";

  function ossKey(collectionId: string, filename: string) {
    return `${prefix}/${collectionId}/${filename}`;
  }

  return {
    async save(collectionId, filename, content) {
      const versionedFilename = `${Date.now()}_${filename}`;
      const key = `${prefix}/${collectionId}/${versionedFilename}`;
      await client.put(key, Buffer.from(content), {
        headers: { "Cache-Control": "no-cache" },
      });
      return versionedFilename;
    },
    async read(collectionId, filename) {
      const key = ossKey(collectionId, filename);
      try {
        const result = await client.get(key);
        return Buffer.from(result.content as Buffer);
      } catch (e: unknown) {
        if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 404) return null;
        throw e;
      }
    },
    async remove(collectionId, filename) {
      const key = ossKey(collectionId, filename);
      await client.delete(key);
    },
    async removeCollection(collectionId) {
      const prefixPath = `${prefix}/${collectionId}/`;
      let marker: string | undefined;
      do {
        const result = await client.listV2({ prefix: prefixPath, "continuation-token": marker, "max-keys": 1000 });
        const objects = result.objects || [];
        if (objects.length > 0) {
          await client.deleteMulti(objects.map((o: { name: string }) => o.name));
        }
        marker = result.nextContinuationToken;
      } while (marker);
    },
    getUrl(collectionId, filename) {
      return `https://${cdnDomain}/${prefix}/${collectionId}/${filename}`;
    },
  };
}
