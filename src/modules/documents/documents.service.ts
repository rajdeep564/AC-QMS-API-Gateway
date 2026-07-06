import { BatchStatus, DeptName, DocStatus, DocType, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma-types";
import { AppError } from "../../lib/app-error";
import { JwtAccessPayload } from "../../types/auth.types";
import { AuditAction, AuditEntityType, log as auditLog } from "../../services/audit.service";
import { batchLink } from "../../services/notification-links";
import { notify } from "../../services/notification.service";
import { renderDocuments } from "../../services/render-documents.service";
import { transition, getAllowedAwsDocumentActions } from "../../services/workflow-engine";
import {
  resolveWorkflowEntityType,
  WorkflowAction,
  WorkflowStatus,
} from "../../services/workflow.config";
import { getUserById, verifyUserPassword } from "../auth/auth.service";
import {
  findDepartmentIdByName,
  resolveRecipients,
} from "../notifications/notifications.repository";
import * as batchesRepo from "../batches/batches.repository";
import { toDocumentDetail } from "./documents.mapper";
import { DocumentAllowedAction, DocumentDetailDto } from "./documents.types";
import * as documentsRepo from "./documents.repository";

function resolveEntityTypeOrThrow(docType: DocType) {
  const entityType = resolveWorkflowEntityType(docType);
  if (!entityType) {
    throw AppError.forbidden("Document lifecycle is not implemented for this document type");
  }
  return entityType;
}

export async function getDocumentDetail(
  documentId: string,
  actor: JwtAccessPayload,
): Promise<DocumentDetailDto> {
  const doc = await documentsRepo.findDocumentDetail(documentId);
  if (!doc) {
    throw AppError.notFound("Document");
  }

  const entityType = resolveWorkflowEntityType(doc.docType);
  const allowedActions: DocumentAllowedAction[] =
    entityType === "AWS_DOCUMENT"
      ? getAllowedAwsDocumentActions(
          doc.status as WorkflowStatus,
          actor.role,
          actor.userId,
          {
            createdById: doc.createdById,
            submittedById: doc.submittedById,
            qcApprovedById: doc.qcApprovedById,
            assignedQcExecId: doc.batch.assignedQcExecId,
          },
        )
      : doc.docType === DocType.COA &&
          doc.status === DocStatus.AUTO_GENERATED &&
          actor.role === Role.QA_MGR
        ? ["SIGN_ISSUE"]
        : [];

  return toDocumentDetail(doc, allowedActions);
}

export async function transitionDocument(
  documentId: string,
  action: WorkflowAction,
  actor: JwtAccessPayload,
  password?: string,
  ipAddress?: string,
  comment?: string,
): Promise<DocumentDetailDto> {
  const doc = await documentsRepo.findDocumentDetail(documentId);
  if (!doc) {
    throw AppError.notFound("Document");
  }

  resolveEntityTypeOrThrow(doc.docType);

  await transition({
    entityType: "AWS_DOCUMENT",
    entityId: documentId,
    action,
    actor,
    password,
    comment,
    ipAddress,
  });

  return getDocumentDetail(documentId, actor);
}

export async function signAndIssueCoa(
  documentId: string,
  actor: JwtAccessPayload,
  password: string,
  ipAddress?: string,
): Promise<DocumentDetailDto> {
  const doc = await documentsRepo.findDocumentDetail(documentId);
  if (!doc) {
    throw AppError.notFound("Document");
  }

  if (doc.docType !== DocType.COA) {
    throw AppError.coaNotSignable("Sign-and-issue is only available for COA documents");
  }

  if (doc.status !== DocStatus.AUTO_GENERATED) {
    throw AppError.coaNotSignable();
  }

  if (actor.role !== Role.QA_MGR) {
    throw AppError.forbidden("Role QA_MGR is required for COA sign-and-issue");
  }

  await verifyUserPassword(actor.userId, password);

  const actorUser = await getUserById(actor.userId);
  const batchMeta = doc.batch;

  await prisma.$transaction(async (tx) => {
    await batchesRepo.transitionCoaDocumentToIssued(documentId, tx);
    await batchesRepo.releaseBatch(doc.batchId, tx);

    if (batchMeta.arnNo) {
      const recipientIds = new Set<string>();
      if (batchMeta.createdById) recipientIds.add(batchMeta.createdById);
      if (batchMeta.assignedQcExecId) recipientIds.add(batchMeta.assignedQcExecId);

      const qcDeptId = await findDepartmentIdByName(DeptName.QC, tx);
      const qaDeptId = await findDepartmentIdByName(DeptName.QA, tx);

      if (qcDeptId) {
        (await resolveRecipients({ role: Role.QC_MGR, departmentId: qcDeptId }, tx)).forEach(
          (id) => recipientIds.add(id),
        );
      }
      if (qaDeptId) {
        (await resolveRecipients({ role: Role.QA_MGR, departmentId: qaDeptId }, tx)).forEach(
          (id) => recipientIds.add(id),
        );
      }

      await notify({
        recipients: { users: [...recipientIds] },
        type: "BATCH_RELEASED",
        title: `Batch ${batchMeta.arnNo} released`,
        message: `Batch ${batchMeta.batchNo} (${batchMeta.arnNo}) has been released.`,
        link: batchLink(doc.batchId),
        excludeUserId: actor.userId,
        tx,
      });
    }
  });

  await renderDocuments("COA", documentId, {
    userId: actor.userId,
    docNo: doc.docNo,
  });

  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.SIGN_ISSUE,
    entityType: AuditEntityType.COA,
    entityId: doc.id,
    docNo: doc.docNo,
    fieldChanged: "status",
    oldValue: DocStatus.AUTO_GENERATED,
    newValue: DocStatus.ISSUED,
    ipAddress,
  });

  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.UPDATE,
    entityType: AuditEntityType.BATCH,
    entityId: doc.batchId,
    fieldChanged: "status",
    oldValue: BatchStatus.APPROVED,
    newValue: BatchStatus.RELEASED,
    comment: `Batch released via COA ${doc.docNo} sign-and-issue`,
    ipAddress,
  });

  return getDocumentDetail(documentId, actor);
}
