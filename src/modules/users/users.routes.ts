import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { list } from "./users.controller";
import { listUsersQuerySchema } from "./users.schema";

const router = Router();

router.get(
  "/",
  requireAuth,
  requireRole(Role.QC_MGR, Role.QA_MGR, Role.SADMIN),
  validate(listUsersQuerySchema, "query"),
  list,
);

export default router;
