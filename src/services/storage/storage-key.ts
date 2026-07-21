import path from "path";

/**
 * Collision-free relative storage key for rendered documents.
 * Format: `{productCode}/{batchNo}/{docType}_{safeDocNo}_{fileType}_{timestamp}.{ext}`
 * Standing docs use batchNo `_`.
 */
export function buildRenderedStorageKey(input: {
  productCode: string;
  batchNo: string;
  docTypeLabel: string;
  docNo: string;
  fileType: "DOCX" | "PDF" | string;
  timestamp?: number;
}): string {
  const safeDocNo = input.docNo.replace(/[\\/:\s]+/g, "_");
  const ext = String(input.fileType).toLowerCase() === "pdf" ? "pdf" : "docx";
  const fileType = String(input.fileType).toUpperCase();
  const ts = input.timestamp ?? Date.now();
  const fileName = `${input.docTypeLabel}_${safeDocNo}_${fileType}_${ts}.${ext}`;
  return path.posix.join(input.productCode, input.batchNo || "_", fileName);
}

export function contentTypeForFileType(fileType: "DOCX" | "PDF" | string): string {
  switch (String(fileType).toUpperCase()) {
    case "PDF":
      return "application/pdf";
    case "DOCX":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}
