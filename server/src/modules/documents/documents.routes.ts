import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { rejectBodySchema, transitionBodySchema } from "../masters/masters.schema";
import { approve, getById, reject, sign, signAndIssue, submit } from "./documents.controller";

const router = Router();

router.get("/:id", requireAuth, getById);
router.post(
  "/:id/submit",
  requireAuth,
  requireRole(Role.QC_EXEC),
  validate(transitionBodySchema),
  submit,
);
router.post(
  "/:id/approve",
  requireAuth,
  requireRole(Role.QC_MGR),
  validate(transitionBodySchema),
  approve,
);
router.post(
  "/:id/sign",
  requireAuth,
  requireRole(Role.QA_MGR),
  validate(transitionBodySchema),
  sign,
);
router.post(
  "/:id/sign-and-issue",
  requireAuth,
  requireRole(Role.QA_MGR),
  validate(transitionBodySchema),
  signAndIssue,
);
router.post(
  "/:id/reject",
  requireAuth,
  requireRole(Role.QC_MGR, Role.QA_MGR),
  validate(rejectBodySchema),
  reject,
);

export default router;

export { createSpec } from "./documents.controller";
