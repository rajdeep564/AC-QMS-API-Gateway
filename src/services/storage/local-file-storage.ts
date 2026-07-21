import { access, mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { DocumentSaveResult, DocumentStorage } from "./document-storage.types";

/**
 * Local filesystem implementation of DocumentStorage.
 * Root is DOCUMENT_STORAGE_ROOT (absolute or relative to cwd).
 */
export class LocalFileStorage implements DocumentStorage {
  constructor(private readonly root: string) {}

  private absolute(storageKey: string): string {
    const normalized = storageKey.replace(/\\/g, "/");
    if (normalized.includes("..") || path.isAbsolute(normalized)) {
      throw new Error(`Invalid storage key: ${storageKey}`);
    }
    const absolute = path.resolve(this.root, ...normalized.split("/"));
    const rootAbs = path.resolve(this.root);
    if (!absolute.startsWith(rootAbs + path.sep) && absolute !== rootAbs) {
      throw new Error(`Storage key escapes root: ${storageKey}`);
    }
    return absolute;
  }

  resolveAbsolute(storageKey: string): string {
    return this.absolute(storageKey);
  }

  async save(key: string, bytes: Buffer, _contentType: string): Promise<DocumentSaveResult> {
    const absolute = this.absolute(key);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
    return { storageKey: key.replace(/\\/g, "/"), byteLength: bytes.length };
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.absolute(storageKey));
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await access(this.absolute(storageKey));
      return true;
    } catch {
      return false;
    }
  }
}
