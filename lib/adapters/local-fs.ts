import type { Store } from "../backend";
import fs from "fs";
import path from "path";

export function createLocalStore(): Store {
  const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
  const MODULES_DIR = path.join(DATA_DIR, "modules");

  fs.mkdirSync(MODULES_DIR, { recursive: true });

  return {
    async save(collectionId, filename, content) {
      const dir = path.join(MODULES_DIR, collectionId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), content);
    },
    async read(collectionId, filename) {
      const filePath = path.join(MODULES_DIR, collectionId, filename);
      if (!fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath);
    },
    async remove(collectionId, filename) {
      const filePath = path.join(MODULES_DIR, collectionId, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    },
    async removeCollection(collectionId) {
      const dir = path.join(MODULES_DIR, collectionId);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
