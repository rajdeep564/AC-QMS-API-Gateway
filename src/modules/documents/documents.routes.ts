import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import {
  rejectBodySchema,
  submitDocumentBodySchema,
  transitionBodySchema,
} from "../masters/masters.schema";
import {
  approve,
  downloadAttachmentHandler,
  getById,
  getExplorerHandler,
  listAwsApprovalQueueHandler,
  reject,
  retryDocumentRenderHandler,
  sign,
  signAndIssue,
  submit,
} from "./documents.controller";

const router = Router();

router.get(
  "/aws/approval-queue",
  requireAuth,
  requireRole(Role.QC_MGR, Role.SADMIN),
  listAwsApprovalQueueHandler,
);

/** Must be registered before /:id so "explorer" is not captured as a document id. */
router.get("/explorer", requireAuth, getExplorerHandler);

router.get("/attachments/:id/download", requireAuth, downloadAttachmentHandler);

router.post(
  "/:batchDocumentId/render/retry",
  requireAuth,
  requireRole(Role.QC_MGR, Role.QA_MGR, Role.SADMIN),
  retryDocumentRenderHandler,
);

router.get("/:id", requireAuth, getById);
router.post(
  "/:id/submit",
  requireAuth,
  requireRole(Role.QC_EXEC),
  validate(submitDocumentBodySchema),
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
