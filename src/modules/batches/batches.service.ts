import { BatchStatus, Prisma, Role, SpecVariant, StandingDocStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma-types";
import { AppError } from "../../lib/app-error";
import { JwtAccessPayload } from "../../types/auth.types";
import { AuditAction, AuditEntityType, log as auditLog } from "../../services/audit.service";
import { parsePagination } from "../../utils/pagination";
import { expDateFromMfgDate } from "../../utils/dates";
import { getProductCode, parseShelfLifeMonths } from "../../utils/master-fields";
import { batchLink } from "../../services/notification-links";
import { notify } from "../../services/notification.service";
import { getAllowedBatchActions } from "../../services/workflow-engine";
import { getUserById } from "../auth/auth.service";
import * as authRepo from "../auth/auth.repository";
import * as mastersRepo from "../masters/masters.repository";
import * as specsRepo from "../specs/specs.repository";
import { CreateBatchBody, ListBatchesQuery } from "./batches.schema";
import {
  BatchDetailDto,
  BatchDocumentDto,
  BatchListItemDto,
  BatchReadyProductDto,
  CreateBatchResultDto,
  MoaDocumentSectionDto,
  SpecDocumentTestDto,
} from "./batches.types";
import * as batchesRepo from "./batches.repository";
import type { BatchWithDetails } from "./batches.repository";

function decimalToString(value: { toString(): string } | null | undefined): string | null {
  return value ? value.toString() : null;
}

function toDocumentDto(doc: BatchWithDetails["batchDocuments"][number]): BatchDocumentDto {
  return {
    id: doc.id,
    docType: doc.docType,
    docNo: doc.docNo,
    status: doc.status,
    complianceVerdict: doc.complianceVerdict,
  };
}

function toSpecTestDto(test: BatchWithDetails["specDocTests"][number]): SpecDocumentTestDto {
  return {
    id: test.id,
    sourceSpecTestId: test.sourceSpecTestId,
    testName: test.testName,
    resultType: test.resultType,
    operator: test.operator,
    minValue: decimalToString(test.minValue),
    maxValue: decimalToString(test.maxValue),
    uom: test.uom,
    acceptanceCriteria: test.acceptanceCriteria,
    formula: test.formula,
    sortOrder: test.sortOrder,
    isOutsideLab: test.isOutsideLab,
  };
}

function toMoaSectionDto(section: BatchWithDetails["moaDocSections"][number]): MoaDocumentSectionDto {
  return {
    id: section.id,
    sourceMoaSectionId: section.sourceMoaSectionId,
    specDocumentTestId: section.specDocumentTestId,
    procedureSnapshot: section.procedureSnapshot,
  };
}

function toBatchDetail(batch: BatchWithDetails, actor: JwtAccessPayload): BatchDetailDto {
  return {
    id: batch.id,
    productId: batch.productId,
    sourceSpecId: batch.sourceSpecId,
    batchNo: batch.batchNo,
    arnNo: batch.arnNo,
    status: batch.status,
    mfgDate: batch.mfgDate,
    expDate: batch.expDate,
    batchSize: batch.batchSize,
    assignedQcExecId: batch.assignedQcExecId,
    createdById: batch.createdById,
    approvedById: batch.approvedById,
    createdAt: batch.createdAt,
    releasedAt: batch.releasedAt,
    product: { id: batch.product.id, name: batch.product.name },
    sourceSpec: {
      id: batch.sourceSpec.id,
      specNo: batch.sourceSpec.specNo,
      revisionNo: batch.sourceSpec.revisionNo,
      status: batch.sourceSpec.status,
    },
    assignedQcExec: batch.assignedQcExec
      ? { id: batch.assignedQcExec.id, fullName: batch.assignedQcExec.fullName }
      : null,
    createdBy: { id: batch.createdBy.id, fullName: batch.createdBy.fullName },
    approvedBy: batch.approvedBy
      ? { id: batch.approvedBy.id, fullName: batch.approvedBy.fullName }
      : null,
    specDocTests: batch.specDocTests.map(toSpecTestDto),
    moaDocSections: batch.moaDocSections.map(toMoaSectionDto),
    batchDocuments: batch.batchDocuments.map(toDocumentDto),
    allowedActions: getAllowedBatchActions(batch.status, actor.role, actor.userId, {
      createdById: batch.createdById,
    }),
  };
}

async function getActiveMasterContext(productId: string) {
  const master = await mastersRepo.findActiveMasterForProduct(productId);
  if (!master) {
    throw AppError.conflict("An ACTIVE Product Master is required before batch creation");
  }
  const masterWithFields = await mastersRepo.findMasterWithFields(master.id);
  if (!masterWithFields) {
    throw AppError.conflict("An ACTIVE Product Master is required before batch creation");
  }
  return {
    productCode: getProductCode(masterWithFields.fields),
    shelfLifeMonths: parseShelfLifeMonths(masterWithFields.fields),
  };
}

function resolveBatchExpDate(mfgDate: Date | undefined, shelfLifeMonths: number): Date | undefined {
  if (!mfgDate) return undefined;
  return expDateFromMfgDate(mfgDate, shelfLifeMonths);
}

async function validateAssignee(assignedQcExecId: string): Promise<void> {
  const user = await authRepo.findActiveQcExec(assignedQcExecId);
  if (!user) {
    throw AppError.invalidAssignee();
  }
}

function buildProcedureSnapshot(section: {
  pharmacopoeia: string | null;
  samplePreparation: string | null;
  standardPreparation: string | null;
  blankPreparation: string | null;
  conclusionTemplate: string | null;
  additionalNotes: string | null;
}): string {
  return JSON.stringify({
    pharmacopoeia: section.pharmacopoeia,
    samplePreparation: section.samplePreparation,
    standardPreparation: section.standardPreparation,
    blankPreparation: section.blankPreparation,
    conclusionTemplate: section.conclusionTemplate,
    additionalNotes: section.additionalNotes,
  });
}

export async function listBatches(query: ListBatchesQuery) {
  const { page, limit, skip, take } = parsePagination(query as Record<string, unknown>);

  const where: Prisma.BatchWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.product) where.productId = query.product;
  if (query.assignedTo) where.assignedQcExecId = query.assignedTo;

  const [items, total] = await Promise.all([
    batchesRepo.listBatches(where, skip, take),
    batchesRepo.countBatches(where),
  ]);

  const mapped: BatchListItemDto[] = items.map((batch) => ({
    id: batch.id,
    productId: batch.productId,
    sourceSpecId: batch.sourceSpecId,
    batchNo: batch.batchNo,
    arnNo: batch.arnNo,
    status: batch.status,
    mfgDate: batch.mfgDate,
    expDate: batch.expDate,
    batchSize: batch.batchSize,
    assignedQcExecId: batch.assignedQcExecId,
    createdById: batch.createdById,
    approvedById: batch.approvedById,
    createdAt: batch.createdAt,
    releasedAt: batch.releasedAt,
    product: batch.product ? { id: batch.product.id, name: batch.product.name } : undefined,
    assignedQcExec: batch.assignedQcExec
      ? { id: batch.assignedQcExec.id, fullName: batch.assignedQcExec.fullName }
      : null,
    batchDocuments: batch.batchDocuments.map((doc) => ({
      id: doc.id,
      docType: doc.docType,
      docNo: doc.docNo,
      status: doc.status,
      complianceVerdict: null,
    })),
  }));

  return { items: mapped, total, page, limit };
}

export async function listBatchReadyProducts(): Promise<BatchReadyProductDto[]> {
  const products = await prisma.product.findMany({ orderBy: { name: "asc" } });
  const ready: BatchReadyProductDto[] = [];

  for (const product of products) {
    const master = await mastersRepo.findActiveMasterForProduct(product.id);
    if (!master) continue;

    const spec = await specsRepo.findBatchReadySpec(product.id, SpecVariant.GENERAL);
    if (!spec) continue;

    const masterWithFields = await mastersRepo.findMasterWithFields(master.id);
    if (!masterWithFields) continue;

    try {
      ready.push({
        productId: product.id,
        productName: product.name,
        sourceSpecId: spec.id,
        specNo: spec.specNo,
        revisionNo: spec.revisionNo,
        shelfLifeMonths: parseShelfLifeMonths(masterWithFields.fields),
      });
    } catch {
      // Skip products whose ACTIVE master lacks shelf-life metadata.
    }
  }

  return ready;
}

export async function createBatch(
  productId: string,
  body: CreateBatchBody,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<CreateBatchResultDto> {
  await validateAssignee(body.assignedQcExecId);

  const batchReady = await specsRepo.findBatchReadySpec(productId, SpecVariant.GENERAL);
  if (!batchReady || batchReady.id !== body.sourceSpecId) {
    throw AppError.conflict("No QA_SIGNED standing SPEC available for batch creation");
  }

  if (batchReady.status !== StandingDocStatus.QA_SIGNED) {
    throw AppError.conflict("Source SPEC must be QA_SIGNED");
  }

  const spec = await specsRepo.findSpecWithDetails(body.sourceSpecId);
  if (!spec || spec.productId !== productId) {
    throw AppError.validation("Source SPEC does not belong to this product");
  }

  if (!spec.moaDoc || spec.moaDoc.sections.length === 0) {
    throw AppError.conflict("Source SPEC must have paired MOA sections");
  }

  const specTests = spec.specTests.map((test) => ({
    sourceSpecTestId: test.id,
    testName: test.testName,
    resultType: test.resultType,
    operator: test.operator,
    minValue: test.minValue,
    maxValue: test.maxValue,
    uom: test.uom,
    acceptanceCriteria: test.acceptanceCriteria,
    formula: test.formula,
    sortOrder: test.sortOrder,
    isOutsideLab: test.isOutsideLab,
  }));

  const testIdBySpecTestId = new Map(spec.specTests.map((t) => [t.id, t.id]));

  const moaSections = spec.moaDoc.sections
    .filter((section) => section.specTestId && testIdBySpecTestId.has(section.specTestId))
    .map((section) => ({
      sourceMoaSectionId: section.id,
      sourceSpecTestId: section.specTestId!,
      procedureSnapshot: buildProcedureSnapshot(section),
    }));

  const actorUser = await getUserById(actor.userId);
  const assigneeName = await getAssigneeName(body.assignedQcExecId);
  const { productCode, shelfLifeMonths } = await getActiveMasterContext(productId);
  const expDate = resolveBatchExpDate(body.mfgDate, shelfLifeMonths);

  const batch = await prisma.$transaction(async (tx) => {
    const created = await batchesRepo.createBatchWithSnapshot(
      {
        productId,
        sourceSpecId: body.sourceSpecId,
        batchNo: body.batchNo,
        productCode,
        createdById: actor.userId,
        assignedQcExecId: body.assignedQcExecId,
        mfgDate: body.mfgDate,
        expDate,
        batchSize: body.batchSize,
      },
      specTests,
      moaSections,
      tx,
    );

    if (!created) {
      throw AppError.fromCode("INTERNAL", "Batch creation failed");
    }

    await auditLog(
      {
        userId: actor.userId,
        userName: actorUser?.fullName,
        role: actor.role,
        department: actorUser?.department?.name,
        action: AuditAction.CREATE,
        entityType: AuditEntityType.BATCH,
        entityId: created.id,
        docNo: created.arnNo ?? undefined,
        comment: `SPEC ${created.sourceSpec.specNo}, assigned to ${assigneeName ?? body.assignedQcExecId}`,
        ipAddress,
      },
      tx,
    );

    return created;
  });

  await notify({
    recipients: { users: [body.assignedQcExecId] },
    type: "BATCH_ASSIGNED",
    title: "Batch assignment",
    message: `You've been assigned to batch ${batch.batchNo} (${batch.arnNo ?? ""}).`,
    link: batchLink(batch.id),
    excludeUserId: actor.userId,
  });

  return { batch: toBatchDetail(batch, actor) };
}

export async function getBatchById(batchId: string, actor: JwtAccessPayload): Promise<BatchDetailDto> {
  const batch = await batchesRepo.findBatchWithDetails(batchId);
  if (!batch) {
    throw AppError.notFound("Batch");
  }
  return toBatchDetail(batch, actor);
}

export async function submitBatch(batchId: string, actor: JwtAccessPayload, ipAddress?: string) {
  const { transition } = await import("../../services/workflow-engine");
  await transition({
    entityType: "BATCH",
    entityId: batchId,
    action: "SUBMIT",
    actor,
    ipAddress,
  });
  return getBatchById(batchId, actor);
}

export async function approveBatch(
  batchId: string,
  password: string,
  actor: JwtAccessPayload,
  ipAddress?: string,
) {
  const { transition } = await import("../../services/workflow-engine");
  await transition({
    entityType: "BATCH",
    entityId: batchId,
    action: "APPROVE",
    actor,
    password,
    ipAddress,
  });
  return getBatchById(batchId, actor);
}

export async function rejectBatch(
  batchId: string,
  comment: string,
  actor: JwtAccessPayload,
  ipAddress?: string,
) {
  const { transition } = await import("../../services/workflow-engine");
  await transition({
    entityType: "BATCH",
    entityId: batchId,
    action: "REJECT",
    actor,
    comment,
    ipAddress,
  });
  return getBatchById(batchId, actor);
}

export async function getAssigneeName(userId: string): Promise<string | undefined> {
  const user = await authRepo.findUserFullName(userId);
  return user?.fullName;
}
