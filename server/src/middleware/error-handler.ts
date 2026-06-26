import { Prisma } from "@prisma/client";
import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { config } from "../config/env";
import { AppError } from "../lib/app-error";
import { fail } from "../lib/api-response";
import { getLogger } from "../lib/request-context";

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      getLogger().error({ err: error, code: error.code }, error.message);
    } else {
      getLogger().warn({ code: error.code }, error.message);
    }

    return res.status(error.statusCode).json(
      fail(error.code, error.message, error.details),
    );
  }

  if (error instanceof ZodError) {
    getLogger().warn({ issues: error.errors }, "Validation error");
    const appError = AppError.validation(error.errors);
    return res.status(appError.statusCode).json(
      fail(appError.code, appError.message, appError.details),
    );
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const appError = AppError.conflict("A record with this value already exists");
      return res.status(appError.statusCode).json(
        fail(appError.code, appError.message),
      );
    }

    if (error.code === "P2025") {
      const appError = AppError.notFound();
      return res.status(appError.statusCode).json(
        fail(appError.code, appError.message),
      );
    }
  }

  if (config.nodeEnv !== "production" && error instanceof Error) {
    getLogger().error({ err: error }, error.message);
  } else {
    getLogger().error("Unhandled error");
  }

  const internal = AppError.fromCode("INTERNAL");
  return res.status(internal.statusCode).json(
    fail(internal.code, internal.message),
  );
}
