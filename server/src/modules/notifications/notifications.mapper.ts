import type { Notification } from "@prisma/client";
import { NotificationDto } from "./notifications.types";

export function toNotificationDto(row: Notification): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    link: row.link,
    isRead: row.isRead,
    createdAt: row.createdAt,
  };
}
