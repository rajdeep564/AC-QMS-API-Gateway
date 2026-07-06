import { Role } from "@prisma/client";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import {
  approve,
  assign,
  getById,
  patchFields,
  reject,
} from "./masters.controller";
import {
  assignBodySchema,
  patchFieldsBodySchema,
  rejectBodySchema,
} from "./masters.schema";

const router = Router();

router.get("/:id", requireAuth, getById);
router.patch("/:id/fields", requireAuth, validate(patchFieldsBodySchema), patchFields);
router.post("/:id/approve", requireAuth, requireRole(Role.SADMIN), approve);
router.post("/:id/reject", requireAuth, requireRole(Role.SADMIN), validate(rejectBodySchema), reject);
router.post("/:id/assign", requireAuth, requireRole(Role.SADMIN), validate(assignBodySchema), assign);

export default router;
