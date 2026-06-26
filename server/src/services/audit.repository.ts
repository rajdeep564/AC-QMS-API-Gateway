import { Db, prisma } from "../lib/prisma-types";
import type { AuditInput } from "./audit.service";

export async function createAuditLog(input: AuditInput, client: Db = prisma): Promise<void> {
  await client.auditLog.create({
    data: {
      timestamp: new Date(),
      userId: input.userId ?? null,
      userName: input.userName ?? null,
      role: input.role ?? null,
      department: input.department ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      docNo: input.docNo ?? null,
      fieldChanged: input.fieldChanged ?? null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      comment: input.comment ?? null,
      ipAddress: input.ipAddress ?? null,
    },
  });
}
