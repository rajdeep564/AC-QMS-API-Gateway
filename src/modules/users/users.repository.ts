import { Prisma, UserStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma-types";
import type { ListUsersQuery } from "./users.schema";

const userListSelect = {
  id: true,
  fullName: true,
  role: true,
  status: true,
  department: { select: { name: true } },
} satisfies Prisma.UserSelect;

export type UserListRow = Prisma.UserGetPayload<{ select: typeof userListSelect }>;

export async function listUsers(query: ListUsersQuery): Promise<UserListRow[]> {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
  };

  if (query.active) {
    where.status = UserStatus.ACTIVE;
  }

  if (query.role) {
    where.role = query.role;
  }

  if (query.dept) {
    where.department = { name: query.dept };
  }

  return prisma.user.findMany({
    where,
    select: userListSelect,
    orderBy: { fullName: "asc" },
  });
}
