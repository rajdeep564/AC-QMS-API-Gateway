import { DeptName, Role } from "@prisma/client";
import { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/app-error";
import * as authRepo from "../modules/auth/auth.repository";

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(AppError.fromCode("UNAUTHORIZED"));
    }

    if (!roles.includes(req.user.role)) {
      return next(AppError.forbidden("Insufficient role permissions"));
    }

    return next();
  };
}

export function requireDept(...deptNames: DeptName[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return next(AppError.fromCode("UNAUTHORIZED"));
      }

      if (!req.user.departmentId) {
        return next(AppError.forbidden("Department access required"));
      }

      const departments = await authRepo.findDepartmentsByNames(deptNames);
      const allowedIds = new Set(departments.map((dept) => dept.id));
      if (!allowedIds.has(req.user.departmentId)) {
        return next(AppError.forbidden("Insufficient department access"));
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}
