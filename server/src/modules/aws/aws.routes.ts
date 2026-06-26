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
  getSectionById,
  listSections,
  patchSection,
  previewSection,
  rejectCheckSection,
} from "./aws.controller";
import {
  acknowledgeExpiredBodySchema,
  acknowledgeOosBodySchema,
  patchAwsSectionBodySchema,
  previewAwsSectionBodySchema,
  rejectCheckBodySchema,
} from "./aws.schema";

const awsDocRouter = Router();
const awsSectionRouter = Router();

awsDocRouter.get("/:awsDocId/sections", requireAuth, listSections);

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

export { awsDocRouter, awsSectionRouter };
