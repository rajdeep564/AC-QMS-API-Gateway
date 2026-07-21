import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { transitionBodySchema } from "../masters/masters.schema";
import {
  acknowledgeExpired,
  acknowledgeOos,
  checkSection,
  completeSection,
  deleteAttachment,
  getSectionById,
  listAttachments,
  listSections,
  patchSection,
  patchSectionByManager,
  previewSection,
  rejectCheckSection,
  uploadAttachment,
} from "./aws.controller";
import {
  acknowledgeExpiredBodySchema,
  acknowledgeOosBodySchema,
  patchAwsSectionBodySchema,
  patchAwsSectionByManagerBodySchema,
  previewAwsSectionBodySchema,
  rejectCheckBodySchema,
  uploadAttachmentBodySchema,
} from "./aws.schema";

const awsDocRouter = Router();
const awsSectionRouter = Router();

awsDocRouter.get("/:awsDocId/sections", requireAuth, listSections);
/** C-4: QC Manager edit pre-QA-sign — PATCH /aws/documents/:awsDocId/sections/:sectionId */
awsDocRouter.patch(
  "/:awsDocId/sections/:sectionId",
  requireAuth,
  requireRole(Role.QC_MGR),
  validate(patchAwsSectionByManagerBodySchema),
  patchSectionByManager,
);

awsSectionRouter.get("/:id", requireAuth, getSectionById);
awsSectionRouter.patch(
  "/:id",
  requireAuth,
  requireRole(Role.QC_EXEC),
  validate(patchAwsSectionBodySchema),
  patchSection,
);
awsSectionRouter.post(
  "/:id/preview",
  requireAuth,
  requireRole(Role.QC_EXEC),
  validate(previewAwsSectionBodySchema),
  previewSection,
);
awsSectionRouter.post(
  "/:id/acknowledge-expired",
  requireAuth,
  requireRole(Role.QC_EXEC),
  validate(acknowledgeExpiredBodySchema),
  acknowledgeExpired,
);
awsSectionRouter.post(
  "/:id/acknowledge-oos",
  requireAuth,
  requireRole(Role.QC_EXEC),
  validate(acknowledgeOosBodySchema),
  acknowledgeOos,
);
awsSectionRouter.post(
  "/:id/complete",
  requireAuth,
  requireRole(Role.QC_EXEC),
  completeSection,
);
awsSectionRouter.post(
  "/:id/check",
  requireAuth,
  requireRole(Role.QC_EXEC),
  validate(transitionBodySchema),
  checkSection,
);
awsSectionRouter.post(
  "/:id/reject-check",
  requireAuth,
  requireRole(Role.QC_EXEC),
  validate(rejectCheckBodySchema),
  rejectCheckSection,
);
awsSectionRouter.get("/:id/attachments", requireAuth, listAttachments);
awsSectionRouter.post(
  "/:id/attachments",
  requireAuth,
  requireRole(Role.QC_EXEC),
  validate(uploadAttachmentBodySchema),
  uploadAttachment,
);
awsSectionRouter.delete(
  "/:id/attachments/:attachmentId",
  requireAuth,
  requireRole(Role.QC_EXEC),
  deleteAttachment,
);

export { awsDocRouter, awsSectionRouter };
