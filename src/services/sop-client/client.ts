import { config } from "../../config/env";
import { AppError } from "../../lib/app-error";

function baseUrl(): string {
  return config.docModuleUrl.replace(/\/$/, "");
}

function apiKey(): string {
  return config.docModuleApiKey;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 800) || response.statusText;
  } catch {
    return response.statusText;
  }
}

function mapHttpError(status: number, detail: string): AppError {
  if (status === 400 || status === 422) {
    return AppError.validation(detail);
  }
  if (status >= 500) {
    return AppError.fromCode(
      "SERVICE_UNAVAILABLE",
      `DOC-Module error HTTP ${status}: ${detail}`,
    );
  }
  return AppError.fromCode("INTERNAL", `DOC-Module unexpected HTTP ${status}: ${detail}`);
}

/**
 * Low-level fetch to DOC-Module. Retries once on 5xx. Throws AppError — never returns null.
 */
export async function docModuleFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const timeoutMs = init.timeoutMs ?? config.docModuleTimeoutMs;
  const { timeoutMs: _t, ...fetchInit } = init;

  const headers = new Headers(fetchInit.headers);
  if (!headers.has("X-API-Key") && path !== "/health") {
    headers.set("X-API-Key", apiKey());
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        ...fetchInit,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status >= 500 && attempt === 0) {
        lastError = mapHttpError(response.status, await readErrorDetail(response));
        continue;
      }

      if (!response.ok) {
        throw mapHttpError(response.status, await readErrorDetail(response));
      }

      return response;
    } catch (err) {
      if (err instanceof AppError) {
        if (err.code === "SERVICE_UNAVAILABLE" && attempt === 0) {
          lastError = err;
          continue;
        }
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout =
        message.includes("TimeoutError") ||
        message.includes("aborted") ||
        message.includes("timeout");
      lastError = AppError.fromCode(
        "SERVICE_UNAVAILABLE",
        isTimeout
          ? `DOC-Module timeout after ${timeoutMs}ms`
          : `DOC-Module network error: ${message}`,
      );
      if (attempt === 0) continue;
      throw lastError;
    }
  }

  throw lastError instanceof AppError
    ? lastError
    : AppError.fromCode("SERVICE_UNAVAILABLE", "DOC-Module unavailable");
}

export async function responseToBuffer(response: Response): Promise<Buffer> {
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
