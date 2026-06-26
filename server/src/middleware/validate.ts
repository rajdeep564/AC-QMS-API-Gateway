import { NextFunction, Request, Response } from "express";
import { ZodSchema } from "zod";
import { AppError } from "../lib/app-error";

type ValidationTarget = "body" | "query" | "params";

export function validate(schema: ZodSchema, target: ValidationTarget = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      return next(AppError.validation(result.error.errors));
    }

    req[target] = result.data;
    return next();
  };
}
