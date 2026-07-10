import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { rejectBodySchema, transitionBodySchema } from "../masters/masters.schema";
import { approve, create, getById, list, reject, submit } from "./batches.controller";
import { createBatchBodySchema, listBatchesQuerySchema } from "./batches.schema";

const router = Router();

router.get("/", requireAuth, validate(listBatchesQuerySchema, "query"), list);
router.get("/:id", requireAuth, getById);
router.post("/:id/submit", requireAuth, requireRole(Role.QC_MGR), submit);
router.post(
  "/:id/approve",
  requireAuth,
  requireRole(Role.QA_MGR),
  validate(transitionBodySchema),
  approve,
);
router.post(
  "/:id/reject",
  requireAuth,
  requireRole(Role.QA_MGR),
  validate(rejectBodySchema),
  reject,
);

export { createBatchBodySchema, create };
export default router;
