import { parsePagination } from "../../utils/pagination";
import type { ListAuditLogsQuery } from "./audit.schema";
import * as auditRepo from "./audit.repository";
import type { AuditLogDto } from "./audit.types";

function toAuditLogDto(row: auditRepo.AuditLogListRow): AuditLogDto {
  return {
    id: row.id,
    timestamp: row.timestamp.toISOString(),
    userId: row.userId,
    userName: row.userName,
    role: row.role,
    department: row.department,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    docNo: row.docNo,
    fieldChanged: row.fieldChanged,
    oldValue: row.oldValue,
    newValue: row.newValue,
    comment: row.comment,
    ipAddress: row.ipAddress,
  };
}

export async function listAuditLogs(query: ListAuditLogsQuery) {
  const { page, limit, skip, take } = parsePagination(query as Record<string, unknown>);
  const where = auditRepo.buildAuditWhere(query);
  const { items, total } = await auditRepo.findAuditLogs(where, skip, take);

  return {
    items: items.map(toAuditLogDto),
    total,
    page,
    limit,
  };
}
