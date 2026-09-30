import type { Db, DbStatement } from "../backend";
import { SCHEMA, applyMigrations } from "../db-schema";

export async function createSqliteDb(): Promise<Db> {
  const Database = (await import("better-sqlite3")).default;
  const path = await import("path");
  const fs = await import("fs");

  const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
  const DB_PATH = path.join(DATA_DIR, "db.sqlite");

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const sqliteDb = new Database(DB_PATH);
  sqliteDb.pragma("journal_mode = WAL");
  sqliteDb.pragma("foreign_keys = ON");
  sqliteDb.exec(SCHEMA);
  applyMigrations((sql) => sqliteDb.exec(sql));

  return {
    prepare(sql: string): DbStatement {
      const stmt = sqliteDb.prepare(sql);
      return {
        async get<T>(...params: unknown[]): Promise<T | undefined> {
          return stmt.get(...params) as T | undefined;
        },
        async all<T>(...params: unknown[]): Promise<T[]> {
          return stmt.all(...params) as T[];
        },
        async run(...params: unknown[]): Promise<void> {
          stmt.run(...params);
        },
      };
    },
    async exec(sql: string): Promise<void> {
      sqliteDb.exec(sql);
    },
  };
}
