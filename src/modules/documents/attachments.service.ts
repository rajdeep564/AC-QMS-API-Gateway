import { BatchStatus, DocType, FileType, Role } from "@prisma/client";
import type { Response } from "express";
import { AppError } from "../../lib/app-error";
import { prisma } from "../../lib/prisma-types";
import {
  AuditAction,
  AuditEntityType,
  log as auditLog,
} from "../../services/audit.service";
import {
  executeDocumentRender,
  retryDocumentRender,
  type ScheduleRenderInput,
} from "../../services/render-documents.service";
import { getDocumentStorage } from "../../services/storage";
import type { JwtAccessPayload } from "../../types/auth.types";
import {
  assertCanAccessDocument,
  buildDocumentAccessFilter,
} from "./document-access";
import * as fileAttachmentsRepo from "./file-attachments.repository";

const QC_QA_ROLES: Role[] = [
  Role.SADMIN,
  Role.QC_EXEC,
  Role.QC_MGR,
  Role.QA_EXEC,
  Role.QA_MGR,
];

const RETRY_ROLES = new Set<Role>([Role.QC_MGR, Role.QA_MGR, Role.SADMIN]);

function contentTypeFor(fileType: FileType): string {
  switch (fileType) {
    case FileType.PDF:
      return "application/pdf";
    case FileType.DOCX:
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}

function extensionFor(fileType: FileType): string {
  switch (fileType) {
    case FileType.PDF:
      return "pdf";
    case FileType.DOCX:
      return "docx";
    default:
      return "bin";
  }
}

function sanitizeFilename(docNo: string, fileType: FileType): string {
  const safe = docNo.replace(/[/\\?%*:|"<>]/g, "_").trim() || "document";
  return `${safe}.${extensionFor(fileType)}`;
}

/**
 * Stream a stored attachment. Access is re-authorized via buildDocumentAccessFilter
 * independently of the explorer tree (403 if out of scope; 404 if missing).
 */
export async function downloadAttachment(
  attachmentId: string,
  actor: JwtAccessPayload,
  res: Response,
): Promise<void> {
  const attachment = await fileAttachmentsRepo.findByIdWithAccessContext(attachmentId);
  if (!attachment) {
    throw AppError.notFound("Attachment");
  }

  const scope = buildDocumentAccessFilter(actor);

  let productId: string;
  let kind: "standing" | "batch";
  let assignedQcExecId: string | null | undefined;
  let entityType: AuditEntityType;
  let entityId: string;
  let docNo: string;

  if (attachment.batchDocument) {
    productId = attachment.batchDocument.batch.productId;
    kind = "batch";
    assignedQcExecId = attachment.batchDocument.batch.assignedQcExecId;
    entityType =
      attachment.batchDocument.docType === DocType.COA
        ? AuditEntityType.COA
        : AuditEntityType.AWS;
    entityId = attachment.batchDocument.id;
    docNo = attachment.batchDocument.docNo;
  } else if (attachment.spec) {
    productId = attachment.spec.productId;
    kind = "standing";
    const isMoa = attachment.filePath.includes("/MOA_");
    entityType = isMoa ? AuditEntityType.MOA : AuditEntityType.SPEC;
    entityId = isMoa
      ? (attachment.spec.moaDoc?.id ?? attachment.spec.id)
      : attachment.spec.id;
    docNo = isMoa
      ? (attachment.spec.moaDoc?.moaNo ?? attachment.spec.specNo)
      : attachment.spec.specNo;
  } else {
    throw AppError.notFound("Attachment");
  }

  await assertCanAccessDocument(scope, {
    productId,
    kind,
    assignedQcExecId,
  });

  const storage = getDocumentStorage();
  if (!(await storage.exists(attachment.filePath))) {
    throw AppError.notFound("Attachment file");
  }

  const bytes = await storage.read(attachment.filePath);
  const filename = sanitizeFilename(docNo, attachment.fileType);
  res.setHeader("Content-Type", contentTypeFor(attachment.fileType));
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", String(bytes.length));
  res.end(bytes);

  const actorUser = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { fullName: true, department: { select: { name: true } } },
  });

  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.EXPORT,
    entityType,
    entityId,
    docNo,
    comment: `Downloaded attachment ${attachment.id} (${filename})`,
  });
}

export async function listBatchDocuments(batchId: string, actor: JwtAccessPayload) {
  // Keep Epic 15 marketing list behavior for this helper; explorer uses shared filter.
  if (actor.role === Role.MKT_EXEC) {
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { status: true },
    });
    if (!batch || batch.status !== BatchStatus.RELEASED) {
      throw AppError.notFound("Batch");
    }
  } else if (!QC_QA_ROLES.includes(actor.role)) {
    throw AppError.forbidden();
  }

  const loaded = await fileAttachmentsRepo.listAttachmentsForBatch(batchId);
  if (!loaded) {
    throw AppError.notFound("Batch");
  }

  const items: Array<{
    id: string;
    docType: string;
    fileType: FileType;
    docNo: string | null;
    downloadUrl: string;
    createdAt: Date;
  }> = [];

  for (const doc of loaded.batch.batchDocuments) {
    if (actor.role === Role.MKT_EXEC && doc.docType !== DocType.COA) continue;
    for (const att of doc.attachments) {
      if (actor.role === Role.MKT_EXEC && att.fileType !== FileType.PDF) continue;
      items.push({
        id: att.id,
        docType: doc.docType,
        fileType: att.fileType,
        docNo: doc.docNo,
        downloadUrl: `/api/v1/documents/attachments/${att.id}/download`,
        createdAt: att.createdAt,
      });
    }
  }

  if (actor.role !== Role.MKT_EXEC) {
    for (const att of loaded.standingAttachments) {
      const isMoa = att.filePath.includes("/MOA_");
      items.push({
        id: att.id,
        docType: isMoa ? "MOA" : "SPEC",
        fileType: att.fileType,
        docNo: isMoa
          ? (att.spec?.moaDoc?.moaNo ?? null)
          : (att.spec?.specNo ?? null),
        downloadUrl: `/api/v1/documents/attachments/${att.id}/download`,
        createdAt: att.createdAt,
      });
    }
  }

  return { batchId, status: loaded.batch.status, documents: items };
}

export async function listSpecDocuments(specId: string, actor: JwtAccessPayload) {
  if (!QC_QA_ROLES.includes(actor.role)) {
    throw AppError.forbidden();
  }

  const loaded = await fileAttachmentsRepo.listAttachmentsForSpec(specId);
  if (!loaded) {
    throw AppError.notFound("SPEC");
  }

  const items: Array<{
    id: string;
    docType: string;
    fileType: FileType;
    docNo: string | null;
    downloadUrl: string;
    createdAt: Date;
  }> = [];

  for (const att of loaded.attachments) {
    const isMoa = att.filePath.includes("/MOA_");
    items.push({
      id: att.id,
      docType: isMoa ? "MOA" : "SPEC",
      fileType: att.fileType,
      docNo: isMoa ? (loaded.spec.moaDoc?.moaNo ?? null) : loaded.spec.specNo,
      downloadUrl: `/api/v1/documents/attachments/${att.id}/download`,
      createdAt: att.createdAt,
    });
  }

  return { specId, status: loaded.spec.status, documents: items };
}

export async function retryBatchDocumentRender(
  batchDocumentId: string,
  actor: JwtAccessPayload,
) {
  if (!RETRY_ROLES.has(actor.role)) {
    throw AppError.forbidden();
  }
  const doc = await prisma.batchDocument.findUnique({
    where: { id: batchDocumentId },
    select: { docType: true },
  });
  if (!doc) throw AppError.notFound("Document");
  if (doc.docType !== DocType.AWS && doc.docType !== DocType.COA) {
    throw AppError.validation("Only AWS or COA documents can be re-rendered");
  }
  const job: ScheduleRenderInput =
    doc.docType === DocType.AWS
      ? { kind: "AWS", batchDocumentId, actorId: actor.userId }
      : { kind: "COA", batchDocumentId, actorId: actor.userId };
  return retryDocumentRender(job);
}

export async function retrySpecRender(specId: string, actor: JwtAccessPayload) {
  if (!RETRY_ROLES.has(actor.role)) {
    throw AppError.forbidden();
  }
  return retryDocumentRender({
    kind: "STANDING_SPEC",
    specId,
    actorId: actor.userId,
  });
}

/** Force-await render (used by verify scripts). */
export async function awaitRender(job: ScheduleRenderInput) {
  return executeDocumentRender(job);
}
