import { docModuleFetch, responseToBuffer } from "./client";
import type { InlineGenerateRequestDto } from "./types";

/** POST /generate — standing documents (specification, moa, …). Returns DOCX Buffer. */
export async function generate(request: InlineGenerateRequestDto): Promise<Buffer> {
  if (
    process.env.STANDING_MOA_GENERATE_FAIL === "1" &&
    request.document_type === "moa"
  ) {
    throw new Error("Simulated MOA generate failure (B-2.4 #7)");
  }
  const response = await docModuleFetch("/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return responseToBuffer(response);
}
