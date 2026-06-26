import { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/app-error";
import { verifyAccess } from "../modules/auth/auth.service";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return next(AppError.fromCode("UNAUTHORIZED", "Missing or invalid authorization header"));
  }

  const token = header.slice("Bearer ".length);
  req.user = verifyAccess(token);
  return next();
}
