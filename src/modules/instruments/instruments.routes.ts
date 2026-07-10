import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { list } from "./instruments.controller";
import { listInstrumentsQuerySchema } from "./instruments.schema";

const router = Router();

/** Epic 12 — QC/QA department + SADMIN; QC_EXEC uses instrument picker during AWS entry. */
router.get(
  "/",
  requireAuth,
  requireRole(Role.QC_EXEC, Role.QC_MGR, Role.QA_EXEC, Role.QA_MGR, Role.SADMIN),
  validate(listInstrumentsQuerySchema, "query"),
  list,
);

export default router;
