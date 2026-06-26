import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { create as createMaster } from "../masters/masters.controller";
import { createMasterBodySchema } from "../masters/masters.schema";
import {
  create as createSpecTemplate,
  list as listSpecTemplates,
} from "../spec-templates/spec-templates.controller";
import {
  createSpecTemplateBodySchema,
  listSpecTemplatesQuerySchema,
} from "../spec-templates/spec-templates.schema";
import { create, getById, list, listMasters } from "./products.controller";
import { createProductBodySchema, listProductsQuerySchema } from "./products.schema";

const router = Router();

router.get("/", requireAuth, validate(listProductsQuerySchema, "query"), list);
router.post(
  "/",
  requireAuth,
  requireRole(Role.QC_EXEC, Role.QC_MGR),
  validate(createProductBodySchema),
  create,
);
router.get("/:id", requireAuth, getById);
router.get("/:id/masters", requireAuth, listMasters);
router.get(
  "/:id/spec-templates",
  requireAuth,
  validate(listSpecTemplatesQuerySchema, "query"),
  listSpecTemplates,
);
router.post(
  "/:productId/masters",
  requireAuth,
  requireRole(Role.QC_EXEC),
  validate(createMasterBodySchema),
  createMaster,
);
router.post(
  "/:productId/spec-templates",
  requireAuth,
  requireRole(Role.QC_EXEC),
  validate(createSpecTemplateBodySchema),
  createSpecTemplate,
);

export default router;
