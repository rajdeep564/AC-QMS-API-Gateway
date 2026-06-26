import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger";
import { runWithRequestContext } from "../lib/request-context";

const HEALTH_PATH = "/api/v1/health";

function requestPath(req: Request): string {
  return req.originalUrl.split("?")[0] ?? req.path;
}

function resolveReqId(req: Request): string {
  const incoming = req.headers["x-request-id"];
  if (typeof incoming === "string" && incoming.trim().length > 0) {
    return incoming.trim();
  }
  return randomUUID();
}

function httpLogLevel(statusCode: number): "info" | "warn" | "error" {
  if (statusCode >= 500) {
    return "error";
  }
  if (statusCode >= 400) {
    return "warn";
  }
  return "info";
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const reqId = resolveReqId(req);
  const requestLoggerInstance = logger.child({ reqId });
  const start = process.hrtime.bigint();

  res.setHeader("X-Request-Id", reqId);

  res.on("finish", () => {
    const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1_000_000 * 100) / 100;
    const isHealth = requestPath(req) === HEALTH_PATH;
    const level = isHealth ? "debug" : httpLogLevel(res.statusCode);
    const path = requestPath(req);
    const message = `${reqId} ${req.method} ${path} → ${res.statusCode} (${durationMs}ms)`;

    requestLoggerInstance[level](
      {
        reqId,
        method: req.method,
        url: path,
        statusCode: res.statusCode,
        durationMs,
      },
      message,
    );
  });

  runWithRequestContext({ reqId, logger: requestLoggerInstance }, () => {
    next();
  });
}
