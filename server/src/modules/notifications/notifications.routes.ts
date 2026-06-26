import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { list, markAllRead, markRead, unreadCount } from "./notifications.controller";
import { listNotificationsQuerySchema } from "./notifications.schema";

const router = Router();

router.get(
  "/",
  requireAuth,
  validate(listNotificationsQuerySchema, "query"),
  list,
);
router.get("/unread-count", requireAuth, unreadCount);
router.patch("/:id/read", requireAuth, markRead);
router.post("/mark-all-read", requireAuth, markAllRead);

export default router;
