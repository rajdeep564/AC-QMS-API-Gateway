import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import {
  ackCcNotification,
  downloadCoa,
  getBatchById,
  getCoaById,
  listDocuments,
} from "./marketing.controller";
import {
  ackCcNotificationBodySchema,
  listMarketingDocumentsQuerySchema,
  marketingIdParamSchema,
} from "./marketing.schema";

const router = Router();

const mktExecOnly = [requireAuth, requireRole(Role.MKT_EXEC)] as const;

router.get(
  "/documents",
  ...mktExecOnly,
  validate(listMarketingDocumentsQuerySchema, "query"),
  listDocuments,
);

router.get(
  "/coas/:id",
  ...mktExecOnly,
  validate(marketingIdParamSchema, "params"),
  getCoaById,
);

router.get(
  "/coas/:id/download",
  ...mktExecOnly,
  validate(marketingIdParamSchema, "params"),
  downloadCoa,
);

router.get(
  "/batches/:id",
  ...mktExecOnly,
  validate(marketingIdParamSchema, "params"),
  getBatchById,
);

router.patch(
  "/cc-notifications/:id/ack",
  ...mktExecOnly,
  validate(marketingIdParamSchema, "params"),
  validate(ackCcNotificationBodySchema),
  ackCcNotification,
);

export default router;
