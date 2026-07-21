import path from "path";
import { FileType } from "@prisma/client";
import type { Response } from "express";
import { AppError } from "../../lib/app-error";
import { prisma } from "../../lib/prisma-types";
import { parsePagination } from "../../utils/pagination";
import { AuditAction, AuditEntityType, log as auditLog } from "../../services/audit.service";
import { getDocumentStorage } from "../../services/storage";
import type { JwtAccessPayload } from "../../types/auth.types";
import {
  toMarketingBatchDetail,
  toMarketingCoaDetail,
  toMarketingDocumentListItem,
} from "./marketing.mapper";
import * as marketingRepo from "./marketing.repository";
import type { ListMarketingDocumentsQuery } from "./marketing.schema";
import type {
  MarketingBatchDetailDto,
  MarketingCoaDetailDto,
  MarketingDocumentListItemDto,
} from "./marketing.types";

export async function listMarketingDocuments(query: ListMarketingDocumentsQuery): Promise<{
  items: MarketingDocumentListItemDto[];
  total: number;
  page: number;
  limit: number;
}> {
  const { page, limit, skip, take } = parsePagination(query as Record<string, unknown>);
  const { items, total } = await marketingRepo.findReleasedDocumentsForMarketing(
    {
      product: query.product,
      customer: query.customer,
      type: query.type,
      search: query.search,
    },
    { skip, take },
  );

  return {
    items: items.map(toMarketingDocumentListItem),
    total,
    page,
    limit,
  };
}

export async function getMarketingCoaById(coaId: string): Promise<MarketingCoaDetailDto> {
  const coa = await marketingRepo.findIssuedCoaById(coaId);
  if (!coa) {
    throw AppError.notFound("COA");
  }
  return toMarketingCoaDetail(coa);
}

/** US-15-1: audit COA download (EXPORT) only — list/detail/batch reads are not audited (system convention). */
export async function downloadMarketingCoaPdf(
  coaId: string,
  actor: JwtAccessPayload,
  res: Response,
  ipAddress?: string,
): Promise<void> {
  const coa = await marketingRepo.findIssuedCoaById(coaId);
  if (!coa) {
    throw AppError.notFound("COA");
  }

  const pdf = await prisma.fileAttachment.findFirst({
    where: { batchDocumentId: coaId, fileType: FileType.PDF },
    orderBy: { createdAt: "desc" },
  });
  if (!pdf) {
    throw AppError.notFound("COA PDF");
  }

  const storage = getDocumentStorage();
  if (!(await storage.exists(pdf.filePath))) {
    throw AppError.notFound("COA PDF");
  }

  const bytes = await storage.read(pdf.filePath);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${path.basename(pdf.filePath)}"`,
  );
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
    entityType: AuditEntityType.COA,
    entityId: coa.id,
    docNo: coa.docNo,
    ipAddress,
    comment: `Marketing COA download ${coa.docNo} (batch ${coa.batch.batchNo})`,
  });
}

export async function getMarketingBatchById(batchId: string): Promise<MarketingBatchDetailDto> {
  const batch = await marketingRepo.findReleasedBatchById(batchId);
  if (!batch) {
    throw AppError.notFound("Batch");
  }
  return toMarketingBatchDetail(batch);
}

/** Epic 27 — sole Marketing write action; not implemented in Phase 1. */
export async function ackCustomerFacingCcNotification(
  _notificationId: string,
  _userId: string,
): Promise<never> {
  throw AppError.notImplemented(
    "Epic 27 Change Control — implement when change_control_notifications exist.",
  );
}
