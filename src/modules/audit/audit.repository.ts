import { Prisma } from "@prisma/client";
import { Db, prisma } from "../../lib/prisma-types";
import type { ListAuditLogsQuery } from "./audit.schema";

export const auditLogListSelect = {
  id: true,
  timestamp: true,
  userId: true,
  userName: true,
  role: true,
  department: true,
  action: true,
  entityType: true,
  entityId: true,
  docNo: true,
  fieldChanged: true,
  oldValue: true,
  newValue: true,
  comment: true,
  ipAddress: true,
} satisfies Prisma.AuditLogSelect;

export type AuditLogListRow = Prisma.AuditLogGetPayload<{ select: typeof auditLogListSelect }>;

export function buildAuditWhere(query: ListAuditLogsQuery): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};

  if (query.entityType) {
    where.entityType = query.entityType;
  }

  if (query.action) {
    where.action = query.action;
  }

  if (query.userId) {
    where.userId = query.userId;
  }

  if (query.entityId) {
    where.entityId = query.entityId;
  }

  if (query.docNo) {
    where.docNo = query.docNo;
  }

  if (query.from || query.to) {
    where.timestamp = {};
    if (query.from) {
      where.timestamp.gte = new Date(query.from);
    }
    if (query.to) {
      where.timestamp.lte = new Date(query.to);
    }
  }

  if (query.search) {
    where.OR = [
      { comment: { contains: query.search, mode: "insensitive" } },
      { docNo: { contains: query.search, mode: "insensitive" } },
    ];
  }

  return where;
}

export async function findAuditLogs(
  where: Prisma.AuditLogWhereInput,
  skip: number,
  take: number,
  client: Db = prisma,
): Promise<{ items: AuditLogListRow[]; total: number }> {
  const [items, total] = await Promise.all([
    client.auditLog.findMany({
      where,
      select: auditLogListSelect,
      orderBy: { timestamp: "desc" },
      skip,
      take,
    }),
    client.auditLog.count({ where }),
  ]);

  return { items, total };
}
