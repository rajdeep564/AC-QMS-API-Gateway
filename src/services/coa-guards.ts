import { DocStatus, DocType } from "@prisma/client";
import { AppError } from "../lib/app-error";
import { JwtAccessPayload } from "../types/auth.types";
import { AuditAction, AuditEntityType, log as auditLog } from "./audit.service";
import { WorkflowAction } from "./workflow.config";

type CoaDocumentRef = {
  id: string;
  docType: DocType;
  status: DocStatus;
  docNo: string;
};

/** US-13-7 — QA_MGR who QC-approved the source AWS cannot sign-and-issue its COA. */
export function enforceCoaSignIssueGuards(
  awsQcApprovedById: string | null,
  actorUserId: string,
): void {
  if (awsQcApprovedById && actorUserId === awsQcApprovedById) {
    throw AppError.selfApproval(
      "QA Manager cannot issue a COA whose AWS they approved as QC Manager",
    );
  }
}

/** US-13-12 — explicit rejection and audit for any workflow edit on a COA. */
export async function rejectCoaWorkflowEdit(
  doc: CoaDocumentRef,
  action: WorkflowAction,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<void> {
  if (doc.docType !== DocType.COA) return;
  if (doc.status !== DocStatus.AUTO_GENERATED && doc.status !== DocStatus.ISSUED) return;

  await auditLog({
    userId: actor.userId,
    role: actor.role,
    action: AuditAction.UPDATE,
    entityType: AuditEntityType.COA,
    entityId: doc.id,
    docNo: doc.docNo,
    comment: `Denied ${action} on COA at ${doc.status}: COA content is derived and cannot be edited`,
    ipAddress,
  });

  throw AppError.coaNotEditable(
    doc.status === DocStatus.ISSUED
      ? "Issued COA cannot be edited; use formal change control"
      : "Auto-generated COA cannot be edited; content is derived from AWS",
  );
}
