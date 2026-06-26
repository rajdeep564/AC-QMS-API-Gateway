import { DocType } from "@prisma/client";

export function marketingCoaLink(coaId: string): string {
  return `/marketing/coas/${coaId}`;
}

export function marketingBatchLink(batchId: string): string {
  return `/marketing/batches/${batchId}`;
}

export function marketingDocumentLink(docType: DocType, documentId: string, batchId: string): string {
  if (docType === DocType.COA) {
    return marketingCoaLink(documentId);
  }
  return marketingBatchLink(batchId);
}
