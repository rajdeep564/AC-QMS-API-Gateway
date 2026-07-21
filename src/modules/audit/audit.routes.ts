import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { list } from "./audit.controller";
import { listAuditLogsQuerySchema } from "./audit.schema";

const router = Router();

router.get(
  "/",
  requireAuth,
  requireRole(Role.SADMIN, Role.QC_MGR, Role.QA_MGR),
  validate(listAuditLogsQuerySchema, "query"),
  list,
);

export default router;
