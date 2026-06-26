import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { createSpec } from "../documents/documents.controller";
import { createSpecBodySchema } from "../documents/documents.schema";
import { create, getById, list } from "./batches.controller";
import { createBatchBodySchema, listBatchesQuerySchema } from "./batches.schema";

const router = Router();

router.get(
  "/",
  requireAuth,
  requireRole(Role.QC_EXEC, Role.QC_MGR, Role.QA_MGR),
  validate(listBatchesQuerySchema, "query"),
  list,
);
router.post(
  "/",
  requireAuth,
  requireRole(Role.QC_MGR),
  validate(createBatchBodySchema),
  create,
);
router.post(
  "/:batchId/spec/create",
  requireAuth,
  requireRole(Role.QC_EXEC),
  validate(createSpecBodySchema),
  createSpec,
);
router.get("/:id", requireAuth, getById);

export default router;
