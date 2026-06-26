import { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/app-error";

export function notFound(_req: Request, _res: Response, next: NextFunction) {
  next(AppError.fromCode("NOT_FOUND"));
}
