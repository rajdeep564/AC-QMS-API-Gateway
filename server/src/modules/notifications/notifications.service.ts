import { parsePagination } from "../../utils/pagination";
import { AppError } from "../../lib/app-error";
import { toNotificationDto } from "./notifications.mapper";
import { ListNotificationsQuery } from "./notifications.schema";
import {
  MarkAllReadResultDto,
  NotificationDto,
  UnreadCountDto,
} from "./notifications.types";
import * as notificationsRepo from "./notifications.repository";

export async function listNotifications(
  userId: string,
  query: ListNotificationsQuery,
): Promise<{ items: NotificationDto[]; total: number; page: number; limit: number }> {
  const { page, limit, skip, take } = parsePagination(query as Record<string, unknown>);

  const [rows, total] = await Promise.all([
    notificationsRepo.findNotificationsForUser(userId, {
      unreadOnly: query.unreadOnly,
      skip,
      take,
    }),
    notificationsRepo.countNotificationsForUser(userId, {
      unreadOnly: query.unreadOnly,
    }),
  ]);

  return {
    items: rows.map(toNotificationDto),
    total,
    page,
    limit,
  };
}

export async function getUnreadCount(userId: string): Promise<UnreadCountDto> {
  const count = await notificationsRepo.countUnreadForUser(userId);
  return { count };
}

export async function markNotificationRead(
  notificationId: string,
  userId: string,
): Promise<NotificationDto> {
  const existing = await notificationsRepo.findNotificationByIdForUser(notificationId, userId);
  if (!existing) {
    throw AppError.notFound("Notification");
  }

  if (!existing.isRead) {
    await notificationsRepo.markNotificationRead(notificationId, userId);
  }

  const updated = await notificationsRepo.findNotificationByIdForUser(notificationId, userId);
  return toNotificationDto(updated!);
}

export async function markAllNotificationsRead(userId: string): Promise<MarkAllReadResultDto> {
  const count = await notificationsRepo.markAllReadForUser(userId);
  return { count };
}
