import { AuditAction, AuditEntityType } from "../services/audit.service";
import { Db, prisma } from "../lib/prisma-types";

export type StageTimestamps = {
  submittedAt: Date | null;
  qcApprovedAt: Date | null;
  qaSignedAt: Date | null;
};

/**
 * Corroborate signature stage timestamps from audit_logs (C-2 — no schema change).
 */
export async function loadStageTimestampsFromAudit(
  entityType: AuditEntityType,
  entityId: string,
  client: Db = prisma,
): Promise<StageTimestamps> {
  const rows = await client.auditLog.findMany({
    where: {
      entityType,
      entityId,
      action: { in: [AuditAction.SUBMIT, AuditAction.APPROVE, AuditAction.SIGN, AuditAction.SIGN_ISSUE] },
    },
    orderBy: { timestamp: "desc" },
    select: { action: true, timestamp: true },
  });

  const result: StageTimestamps = {
    submittedAt: null,
    qcApprovedAt: null,
    qaSignedAt: null,
  };

  for (const row of rows) {
    if (row.action === AuditAction.SUBMIT && !result.submittedAt) {
      result.submittedAt = row.timestamp;
    }
    if (row.action === AuditAction.APPROVE && !result.qcApprovedAt) {
      result.qcApprovedAt = row.timestamp;
    }
    if (
      (row.action === AuditAction.SIGN || row.action === AuditAction.SIGN_ISSUE) &&
      !result.qaSignedAt
    ) {
      result.qaSignedAt = row.timestamp;
    }
  }

  return result;
}
