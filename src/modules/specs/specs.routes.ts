import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { rejectBodySchema, transitionBodySchema } from "../masters/masters.schema";
import { listSpecDocumentsHandler, retrySpecRenderHandler } from "../documents/documents.controller";
import { patchSpecBodySchema, reviseSpecBodySchema } from "./specs.schema";
import {
  approve,
  getById,
  listApprovalQueue,
  listSignatureQueue,
  patch,
  reject,
  revise,
  sign,
  submit,
} from "./specs.controller";

const router = Router();

router.get(
  "/approval-queue",
  requireAuth,
  requireRole(Role.QC_MGR, Role.SADMIN),
  listApprovalQueue,
);
router.get(
  "/signature-queue",
  requireAuth,
  requireRole(Role.QA_MGR, Role.SADMIN),
  listSignatureQueue,
);
router.get("/:id/documents", requireAuth, listSpecDocumentsHandler);
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
router.post("/:id/revise", requireAuth, requireRole(Role.QC_EXEC), validate(reviseSpecBodySchema), revise);
router.post(
  "/:id/render/retry",
  requireAuth,
  requireRole(Role.QC_MGR, Role.QA_MGR, Role.SADMIN),
  retrySpecRenderHandler,
);

export default router;
