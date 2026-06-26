import { AsyncLocalStorage } from "node:async_hooks";
import type { Logger } from "pino";
import { logger as baseLogger } from "./logger";

export type RequestContext = {
  reqId: string;
  logger: Logger;
};

const als = new AsyncLocalStorage<RequestContext>();

export function getStore(): RequestContext | undefined {
  return als.getStore();
}

export function getLogger(): Logger {
  return getStore()?.logger ?? baseLogger;
}

export function runWithRequestContext<T>(store: RequestContext, fn: () => T): T {
  return als.run(store, fn);
}
