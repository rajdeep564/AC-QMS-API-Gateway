import { DeptName, Prisma, Role, UserStatus } from "@prisma/client";
import { Db, prisma } from "../../lib/prisma-types";

export async function findUserForLogin(username: string, client: Db = prisma) {
  return client.user.findFirst({
    where: { username, deletedAt: null },
    include: { department: true },
  });
}

export async function findUserById(userId: string, client: Db = prisma) {
  return client.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: { department: true },
  });
}

export async function findUserFullName(userId: string, client: Db = prisma) {
  return client.user.findUnique({
    where: { id: userId },
    select: { fullName: true },
  });
}

export async function updateUser(
  userId: string,
  data: Prisma.UserUpdateInput,
  client: Db = prisma,
) {
  return client.user.update({ where: { id: userId }, data });
}

export async function createSessionRecord(
  data: Prisma.SessionCreateInput,
  client: Db = prisma,
) {
  return client.session.create({ data });
}

export async function updateSession(
  sessionId: string,
  data: Prisma.SessionUpdateInput,
  client: Db = prisma,
) {
  return client.session.update({ where: { id: sessionId }, data });
}

export async function deleteSessions(
  where: Prisma.SessionWhereInput,
  client: Db = prisma,
) {
  return client.session.deleteMany({ where });
}

export async function findSessionById(sessionId: string, client: Db = prisma) {
  return client.session.findUnique({
    where: { id: sessionId },
    include: {
      user: { include: { department: true } },
    },
  });
}

export async function findDepartmentsByNames(names: DeptName[], client: Db = prisma) {
  return client.department.findMany({
    where: { name: { in: names } },
    select: { id: true },
  });
}

export async function findUsersByRole(role: Role, client: Db = prisma) {
  return client.user.findMany({
    where: { role, deletedAt: null },
    select: { id: true },
  });
}

export async function findActiveQcExec(
  userId: string,
  client: Db = prisma,
) {
  return client.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
      status: UserStatus.ACTIVE,
      role: Role.QC_EXEC,
      department: { name: DeptName.QC },
    },
    include: { department: true },
  });
}
