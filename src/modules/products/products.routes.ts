import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { listBatchReady } from "../batches/batches.controller";
import { create as createMaster } from "../masters/masters.controller";
import { createMasterBodySchema } from "../masters/masters.schema";
import { create as createSpec, listActiveSpecs, listForProduct as listSpecs } from "../specs/specs.controller";
import { createSpecBodySchema, listSpecsQuerySchema } from "../specs/specs.schema";
import { create as createBatch, createBatchBodySchema } from "../batches/batches.routes";
import { create, getById, list, listMasters } from "./products.controller";
import { createProductBodySchema, listProductsQuerySchema } from "./products.schema";

const router = Router();

router.get("/", requireAuth, validate(listProductsQuerySchema, "query"), list);
router.get(
  "/batch-ready",
  requireAuth,
  requireRole(Role.QC_MGR, Role.SADMIN),
  listBatchReady,
);
router.post("/", requireAuth, requireRole(Role.SADMIN), validate(createProductBodySchema), create);
router.get(
  "/:id/active-specs",
  requireAuth,
  requireRole(Role.QC_MGR, Role.SADMIN),
  listActiveSpecs,
);
router.get("/:id", requireAuth, getById);
router.get("/:id/masters", requireAuth, listMasters);
router.post(
  "/:productId/masters",
  requireAuth,
  requireRole(Role.SADMIN),
  validate(createMasterBodySchema),
  createMaster,
);
router.get("/:id/specs", requireAuth, validate(listSpecsQuerySchema, "query"), listSpecs);
router.post(
  "/:productId/specs",
  requireAuth,
  requireRole(Role.QC_EXEC),
  validate(createSpecBodySchema),
  createSpec,
);
router.post(
  "/:productId/batches",
  requireAuth,
  requireRole(Role.QC_MGR),
  validate(createBatchBodySchema),
  createBatch,
);

export default router;
