export { health } from "./health";
export { generate } from "./generate";
export { render } from "./render";
export { convertPdf } from "./convert-pdf";
export type * from "./types";

/**
 * @deprecated Prefer `render("coa", payload)`. Kept for verify-b22 / transitional imports.
 */
export async function postRender(
  documentType: "coa",
  payload: import("./types").CoaRenderInputDto,
): Promise<
  | { ok: true; status: number; contentType: string; byteLength: number; buffer: Buffer }
  | { ok: false; kind: "http" | "network" | "config"; status?: number; message: string }
> {
  try {
    const { render } = await import("./render");
    const buffer = await render(documentType, payload);
    return {
      ok: true,
      status: 200,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      byteLength: buffer.byteLength,
      buffer,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: "network", message };
  }
}
