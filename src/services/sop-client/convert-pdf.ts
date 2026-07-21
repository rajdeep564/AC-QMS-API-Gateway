import { config } from "../../config/env";
import { docModuleFetch, responseToBuffer } from "./client";

/** POST /convert/pdf — multipart DOCX → PDF Buffer (LibreOffice). */
export async function convertPdf(docxBuffer: Buffer, filename = "document.docx"): Promise<Buffer> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(docxBuffer)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    filename.endsWith(".docx") ? filename : `${filename}.docx`,
  );

  const response = await docModuleFetch("/convert/pdf", {
    method: "POST",
    body: form,
    timeoutMs: config.docModulePdfTimeoutMs,
  });
  return responseToBuffer(response);
}
