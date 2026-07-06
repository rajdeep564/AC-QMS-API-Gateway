import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { rejectBodySchema, transitionBodySchema } from "../masters/masters.schema";
import { patchSpecBodySchema } from "./specs.schema";
import {
  approve,
  getById,
  patch,
  reject,
  revise,
  sign,
  submit,
} from "./specs.controller";

const router = Router();

router.get("/:id", requireAuth, getById);
router.patch("/:id", requireAuth, requireRole(Role.QC_EXEC), validate(patchSpecBodySchema), patch);
router.post("/:id/submit", requireAuth, requireRole(Role.QC_EXEC), submit);
router.post("/:id/approve", requireAuth, requireRole(Role.QC_MGR), validate(transitionBodySchema), approve);
router.post("/:id/sign", requireAuth, requireRole(Role.QA_MGR), validate(transitionBodySchema), sign);
router.post(
  "/:id/reject",
  requireAuth,
  requireRole(Role.QC_MGR, Role.QA_MGR),
  validate(rejectBodySchema),
  reject,
);
router.post("/:id/revise", requireAuth, requireRole(Role.QC_EXEC), revise);

export default router;
