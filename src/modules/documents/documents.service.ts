import { DocStatus, DocType, Role } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { JwtAccessPayload } from "../../types/auth.types";
import { rejectCoaWorkflowEdit } from "../../services/coa-guards";
import { renderDocuments } from "../../services/render-documents.service";
import {
  getAllowedAwsDocumentActions,
  getAllowedCoaDocumentActions,
  transition,
} from "../../services/workflow-engine";
import {
  resolveWorkflowEntityType,
  WorkflowAction,
  WorkflowStatus,
} from "../../services/workflow.config";
import { verifyUserPassword } from "../auth/auth.service";
import { toDocumentDetail } from "./documents.mapper";
import { AwsApprovalQueueItemDto, DocumentAllowedAction, DocumentDetailDto } from "./documents.types";
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
      : entityType === "COA_DOCUMENT"
        ? getAllowedCoaDocumentActions(doc.status as WorkflowStatus, actor.role)
        : [];

  return toDocumentDetail(doc, allowedActions);
}

/** US-12-15 — QC Manager queue for SUBMITTED AWS documents. */
export async function listAwsApprovalQueue(
  actor: JwtAccessPayload,
): Promise<AwsApprovalQueueItemDto[]> {
  if (actor.role !== Role.QC_MGR && actor.role !== Role.SADMIN) {
    throw AppError.forbidden("Only QC Manager can view the AWS approval queue");
  }

  const docs = await documentsRepo.listSubmittedAwsForQcApproval();
  return docs.map((doc) => ({
    id: doc.id,
    docNo: doc.docNo,
    batchId: doc.batch.id,
    batchNo: doc.batch.batchNo,
    productId: doc.batch.productId,
    productName: doc.batch.product.name,
    assignedQcExecName: doc.batch.assignedQcExec?.fullName ?? null,
    submittedBy: doc.submittedBy
      ? { username: doc.submittedBy.username, fullName: doc.submittedBy.fullName }
      : null,
    submittedAt: doc.createdAt,
    status: doc.status,
  }));
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

  await rejectCoaWorkflowEdit(doc, action, actor, ipAddress);

  const entityType = resolveEntityTypeOrThrow(doc.docType);

  await transition({
    entityType,
    entityId: documentId,
    action,
    actor,
    password,
    comment,
    ipAddress,
  });

  return getDocumentDetail(documentId, actor);
}

/** US-13-7 — distinct sign-and-issue endpoint; transition executes via workflow engine (S4). */
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

  await transition({
    entityType: "COA_DOCUMENT",
    entityId: documentId,
    action: "SIGN_ISSUE",
    actor,
    password,
    ipAddress,
  });

  await renderDocuments("COA", documentId, {
    userId: actor.userId,
    docNo: doc.docNo,
  });

  return getDocumentDetail(documentId, actor);
}
