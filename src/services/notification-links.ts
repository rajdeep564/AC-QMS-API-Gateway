/** Frontend app routes (Next.js) — keep in sync with AC-QMS-Frontend-Next routes. */

export function batchLink(batchId: string): string {
  return `/batches/${batchId}`;
}

export function awsDocumentLink(documentId: string): string {
  return `/documents/aws/${documentId}`;
}

export function coaDocumentLink(documentId: string): string {
  return `/documents/coa/${documentId}`;
}

export function masterLink(masterId: string): string {
  return `/product-masters/${masterId}`;
}

export function standingSpecLink(specId: string): string {
  return `/specs/${specId}`;
}

/** @deprecated Use awsDocumentLink or coaDocumentLink */
export function documentLink(
  _batchId: string,
  documentId: string,
  docType: "AWS" | "COA" = "AWS",
): string {
  return docType === "COA" ? coaDocumentLink(documentId) : awsDocumentLink(documentId);
}

/** @deprecated Removed in Rev 2.3 — retained for excluded legacy modules only */
export function specTemplateLink(templateId: string): string {
  return `/specs/${templateId}`;
}
