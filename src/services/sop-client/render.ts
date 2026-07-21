import { docModuleFetch, responseToBuffer } from "./client";
import type { AwsRenderInputDto, CoaRenderInputDto } from "./types";

/** POST /render — batch AWS/COA. Returns DOCX Buffer. */
export async function render(
  documentType: "aws",
  payload: AwsRenderInputDto,
): Promise<Buffer>;
export async function render(
  documentType: "coa",
  payload: CoaRenderInputDto,
): Promise<Buffer>;
export async function render(
  documentType: "aws" | "coa",
  payload: AwsRenderInputDto | CoaRenderInputDto,
): Promise<Buffer> {
  const response = await docModuleFetch("/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document_type: documentType, payload }),
  });
  return responseToBuffer(response);
}
