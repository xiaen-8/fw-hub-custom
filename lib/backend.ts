export interface DbStatement {
  get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<void>;
}

export interface Db {
  prepare(sql: string): DbStatement;
  exec(sql: string): Promise<void>;
}

export interface Store {
  save(collectionId: string, filename: string, content: Buffer | Uint8Array): Promise<string | void>;
  read(collectionId: string, filename: string): Promise<Buffer | null>;
  remove(collectionId: string, filename: string): Promise<void>;
  removeCollection(collectionId: string): Promise<void>;
  getUrl?(collectionId: string, filename: string): string | null;
}

const BACKEND = process.env.BACKEND || "local";

let _db: Db | null = null;
let _store: Store | null = null;

async function getCfEnv(): Promise<Record<string, unknown>> {
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const ctx = await getCloudflareContext();
  return ctx.env as Record<string, unknown>;
}

export async function getBackendDb(): Promise<Db> {
  if (BACKEND === "cloudflare") {
    const { createD1Db } = await import("./adapters/d1");
    const env = await getCfEnv();
    return createD1Db(env.DB);
  }
  if (!_db) {
    const { createSqliteDb } = await import("./adapters/sqlite");
    _db = await createSqliteDb();
  }
  return _db;
}

export async function getBackendStore(): Promise<Store> {
  if (BACKEND === "cloudflare") {
    const { createR2Store } = await import("./adapters/r2");
    const env = await getCfEnv();
    return createR2Store(env.STORAGE);
  }
  if (BACKEND === "oss") {
    if (!_store) {
      const { createOssStore } = await import("./adapters/oss");
      _store = createOssStore();
    }
    return _store;
  }
  if (!_store) {
    const { createLocalStore } = await import("./adapters/local-fs");
    _store = createLocalStore();
  }
  return _store;
}
