/**
 * Document storage abstraction — local FS now, S3-swappable later.
 * Call sites depend only on DocumentStorage; never import fs outside the adapter.
 */

export type DocumentSaveResult = {
  storageKey: string;
  byteLength: number;
};

export interface DocumentStorage {
  save(key: string, bytes: Buffer, contentType: string): Promise<DocumentSaveResult>;
  read(storageKey: string): Promise<Buffer>;
  exists(storageKey: string): Promise<boolean>;
  /** Absolute path for a relative key (local adapter); S3 may return the key itself. */
  resolveAbsolute(storageKey: string): string;
}
