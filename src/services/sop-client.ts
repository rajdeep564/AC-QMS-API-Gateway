import { config } from "../config/env";
import type { CoaRenderInputDto } from "./coa-render-mapper";

const RENDER_TIMEOUT_MS = 30_000;

export type SopRenderSuccess = {
  ok: true;
  status: number;
  contentType: string;
  byteLength: number;
};

export type SopRenderFailure = {
  ok: false;
  kind: "http" | "network" | "config";
  status?: number;
  message: string;
};

export type SopRenderResult = SopRenderSuccess | SopRenderFailure;

type RenderDocumentType = "coa";

function renderUrl(): string | null {
  if (!config.docModuleUrl) return null;
  const base = config.docModuleUrl.replace(/\/$/, "");
  return `${base}/render`;
}

/**
 * POST render-ready payload to DOC-Module /render.
 * Returns typed success/failure — never throws.
 */
export async function postRender(
  documentType: RenderDocumentType,
  payload: CoaRenderInputDto,
): Promise<SopRenderResult> {
  const url = renderUrl();
  if (!url || !config.docModuleApiKey) {
    return {
      ok: false,
      kind: "config",
      message: "DOC_MODULE_URL and DOC_MODULE_API_KEY must be configured",
    };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.docModuleApiKey,
      },
      body: JSON.stringify({ document_type: documentType, payload }),
      signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const text = await response.text();
        if (text) detail = text.slice(0, 500);
      } catch {
        // ignore body read failure
      }
      return {
        ok: false,
        kind: "http",
        status: response.status,
        message: `DOC-Module render failed: HTTP ${response.status} — ${detail}`,
      };
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";

    return {
      ok: true,
      status: response.status,
      contentType,
      byteLength: buffer.byteLength,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "network",
      message: `DOC-Module render request failed: ${message}`,
    };
  }
}
