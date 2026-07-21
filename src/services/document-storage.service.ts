/**
 * @deprecated Prefer `getDocumentStorage()` from `./storage`.
 * Thin compatibility re-export for transitional callers.
 */
export {
  getDocumentStorage as documentStorageFactory,
  buildRenderedStorageKey,
  getDocumentStorage,
  LocalFileStorage,
} from "./storage";

import { getDocumentStorage } from "./storage";
import { buildRenderedStorageKey } from "./storage";

/** @deprecated Use buildRenderedStorageKey + getDocumentStorage().save */
export type DocumentStorageMeta = {
  productCode: string;
  batchNo: string;
  docType: string;
  docNo: string;
  ext: "docx" | "pdf";
  generatedBy: string;
};

export type ResolvedDocumentPath = {
  absolutePath: string;
  relativePath: string;
};

export function resolvePath(meta: DocumentStorageMeta): ResolvedDocumentPath {
  const relativePath = buildRenderedStorageKey({
    productCode: meta.productCode,
    batchNo: meta.batchNo,
    docTypeLabel: meta.docType,
    docNo: meta.docNo,
    fileType: meta.ext.toUpperCase(),
  });
  return {
    relativePath,
    absolutePath: getDocumentStorage().resolveAbsolute(relativePath),
  };
}

export async function saveRendered(
  buffer: Buffer,
  meta: DocumentStorageMeta,
): Promise<ResolvedDocumentPath> {
  const relativePath = buildRenderedStorageKey({
    productCode: meta.productCode,
    batchNo: meta.batchNo,
    docTypeLabel: meta.docType,
    docNo: meta.docNo,
    fileType: meta.ext.toUpperCase(),
  });
  const contentType =
    meta.ext === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const saved = await getDocumentStorage().save(relativePath, buffer, contentType);
  return {
    relativePath: saved.storageKey,
    absolutePath: getDocumentStorage().resolveAbsolute(saved.storageKey),
  };
}

export const documentStorage = {
  resolvePath,
  saveRendered,
};
