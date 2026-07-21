import { docModuleFetch } from "./client";
import type { HealthResponse } from "./types";

/** GET /health — no API key. */
export async function health(): Promise<HealthResponse> {
  const response = await docModuleFetch("/health", { method: "GET" });
  return (await response.json()) as HealthResponse;
}
