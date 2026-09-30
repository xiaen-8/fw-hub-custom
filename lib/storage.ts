import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const MODULES_DIR = path.join(DATA_DIR, "modules");

fs.mkdirSync(MODULES_DIR, { recursive: true });

export function getModulePath(collectionId: string, filename: string): string {
  return path.join(MODULES_DIR, collectionId, filename);
}

export function saveModule(collectionId: string, filename: string, content: Buffer): void {
  const dir = path.join(MODULES_DIR, collectionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content);
}

export function readModule(collectionId: string, filename: string): Buffer | null {
  const filePath = getModulePath(collectionId, filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

export function deleteModule(collectionId: string, filename: string): void {
  const filePath = getModulePath(collectionId, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function deleteCollection(collectionId: string): void {
  const dir = path.join(MODULES_DIR, collectionId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
