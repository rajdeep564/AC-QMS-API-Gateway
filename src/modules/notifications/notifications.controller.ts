import { Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ok, paginated } from "../../lib/api-response";
import type { AuthenticatedRequest } from "../../types/authenticated-request";
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notifications.service";
import type { ListNotificationsQuery } from "./notifications.schema";

export const list = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const query = req.query as unknown as ListNotificationsQuery;
  const result = await listNotifications(req.user.userId, query);
  res.json(paginated(result.items, result.total, result.page, result.limit));
});

export const unreadCount = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await getUnreadCount(req.user.userId);
  res.json(ok(result));
});

export const markRead = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const updated = await markNotificationRead(id, req.user.userId);
  res.json(ok(updated));
});

export const markAllRead = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const result = await markAllNotificationsRead(req.user.userId);
  res.json(ok(result));
});
