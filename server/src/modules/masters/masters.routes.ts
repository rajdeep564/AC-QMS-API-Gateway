import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import {
  approve,
  getById,
  reject,
  sign,
  submit,
} from "./masters.controller";
import {
  rejectBodySchema,
  transitionBodySchema,
} from "./masters.schema";

const router = Router();

router.get("/:id", requireAuth, getById);
router.post("/:id/submit", requireAuth, validate(transitionBodySchema), submit);
router.post("/:id/approve", requireAuth, validate(transitionBodySchema), approve);
router.post("/:id/sign", requireAuth, validate(transitionBodySchema), sign);
router.post("/:id/reject", requireAuth, validate(rejectBodySchema), reject);

export default router;
