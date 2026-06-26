import { DeptName, Prisma, Role, UserStatus } from "@prisma/client";
import { Db, prisma } from "../../lib/prisma-types";

export type RecipientSpec =
  | { users: string[] }
  | { role: Role; departmentId?: string }
  | { roles: Role[]; departmentId?: string };

const activeUserWhere = {
  deletedAt: null,
  status: UserStatus.ACTIVE,
} as const;

export async function resolveRecipients(
  spec: RecipientSpec,
  client: Db = prisma,
): Promise<string[]> {
  if ("users" in spec) {
    if (spec.users.length === 0) return [];
    const users = await client.user.findMany({
      where: {
        id: { in: spec.users },
        ...activeUserWhere,
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  const roles = "role" in spec ? [spec.role] : spec.roles;
  const users = await client.user.findMany({
    where: {
      role: { in: roles },
      ...activeUserWhere,
      ...(spec.departmentId ? { departmentId: spec.departmentId } : {}),
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function findDepartmentIdByName(
  name: DeptName,
  client: Db = prisma,
): Promise<string | null> {
  const dept = await client.department.findUnique({
    where: { name },
    select: { id: true },
  });
  return dept?.id ?? null;
}

export async function createNotifications(
  rows: Prisma.NotificationCreateManyInput[],
  client: Db = prisma,
): Promise<void> {
  if (rows.length === 0) return;
  await client.notification.createMany({ data: rows });
}

export async function findNotificationsForUser(
  userId: string,
  options: { unreadOnly?: boolean; skip: number; take: number },
  client: Db = prisma,
) {
  return client.notification.findMany({
    where: {
      userId,
      ...(options.unreadOnly ? { isRead: false } : {}),
    },
    orderBy: { createdAt: "desc" },
    skip: options.skip,
    take: options.take,
  });
}

export async function countNotificationsForUser(
  userId: string,
  options: { unreadOnly?: boolean },
  client: Db = prisma,
): Promise<number> {
  return client.notification.count({
    where: {
      userId,
      ...(options.unreadOnly ? { isRead: false } : {}),
    },
  });
}

export async function countUnreadForUser(userId: string, client: Db = prisma): Promise<number> {
  return countNotificationsForUser(userId, { unreadOnly: true }, client);
}

export async function findNotificationByIdForUser(
  id: string,
  userId: string,
  client: Db = prisma,
) {
  return client.notification.findFirst({
    where: { id, userId },
  });
}

export async function markNotificationRead(
  id: string,
  userId: string,
  client: Db = prisma,
): Promise<boolean> {
  const result = await client.notification.updateMany({
    where: { id, userId, isRead: false },
    data: { isRead: true },
  });
  return result.count > 0;
}

export async function markAllReadForUser(userId: string, client: Db = prisma): Promise<number> {
  const result = await client.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
  return result.count;
}
