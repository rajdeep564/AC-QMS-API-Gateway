import { config } from "../../config/env";
import type { DocumentStorage } from "./document-storage.types";
import { LocalFileStorage } from "./local-file-storage";

/**
 * Factory for the document volume adapter.
 * Future: switch on DOCUMENT_STORAGE_DRIVER=s3 → S3Storage (not implemented).
 */
let cached: DocumentStorage | null = null;
let cachedRoot: string | null = null;
/** Test-only override (e.g. failing storage for non-blocking persistence checks). */
let testOverride: DocumentStorage | null = null;

export function getDocumentStorage(rootOverride?: string): DocumentStorage {
  if (testOverride) {
    return testOverride;
  }
  const root = rootOverride ?? config.documentStorageRoot;
  if (cached && cachedRoot === root) {
    return cached;
  }
  // S3Storage would be selected here when DOCUMENT_STORAGE_DRIVER=s3.
  cached = new LocalFileStorage(root);
  cachedRoot = root;
  return cached;
}

/** Test helper — clears the singleton so a bad-root test can inject a new instance. */
export function resetDocumentStorageCache(): void {
  cached = null;
  cachedRoot = null;
}

/** Test helper — force a specific adapter (pass null to clear). */
export function setDocumentStorageForTest(storage: DocumentStorage | null): void {
  testOverride = storage;
  if (!storage) {
    resetDocumentStorageCache();
  }
}

export type { DocumentStorage, DocumentSaveResult } from "./document-storage.types";
export { LocalFileStorage } from "./local-file-storage";
export { buildRenderedStorageKey, contentTypeForFileType } from "./storage-key";
