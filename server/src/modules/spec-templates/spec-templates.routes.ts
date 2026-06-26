import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import {
  approve,
  copy,
  getById,
  patch,
  reject,
  sign,
  submit,
} from "./spec-templates.controller";
import {
  copySpecTemplateBodySchema,
  patchSpecTemplateBodySchema,
} from "./spec-templates.schema";
import { rejectBodySchema, transitionBodySchema } from "../masters/masters.schema";

const router = Router();

router.get("/:id", requireAuth, getById);
router.patch("/:id", requireAuth, validate(patchSpecTemplateBodySchema), patch);
router.post("/:id/copy", requireAuth, requireRole(Role.QC_EXEC), validate(copySpecTemplateBodySchema), copy);
router.post("/:id/submit", requireAuth, validate(transitionBodySchema), submit);
router.post("/:id/approve", requireAuth, validate(transitionBodySchema), approve);
router.post("/:id/sign", requireAuth, validate(transitionBodySchema), sign);
router.post("/:id/reject", requireAuth, validate(rejectBodySchema), reject);

export default router;
