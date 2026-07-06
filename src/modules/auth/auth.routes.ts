import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import {
  changePassword,
  login,
  logout,
  me,
  refresh,
  verifyPasswordHandler,
} from "./auth.controller";
import {
  changePasswordBodySchema,
  loginBodySchema,
  verifyPasswordBodySchema,
} from "./auth.schema";

const router = Router();

router.post("/login", validate(loginBodySchema), login);
router.post("/refresh", refresh);
router.post("/verify-password", requireAuth, validate(verifyPasswordBodySchema), verifyPasswordHandler);
router.post("/change-password", requireAuth, validate(changePasswordBodySchema), changePassword);
router.post("/logout", requireAuth, logout);
router.get("/me", requireAuth, me);

export default router;
