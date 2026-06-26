import {
  BatchStatus,
  DocPhase,
  DocStatus,
  DocType,
  Prisma,
  TemplateStatus,
} from "@prisma/client";
import { prisma } from "../../lib/prisma-types";
import { AppError } from "../../lib/app-error";
import { JwtAccessPayload } from "../../types/auth.types";
import { parsePagination } from "../../utils/pagination";
import { computeBatchExpiryDate } from "../../utils/dates";
import {
  formatBatchAwsDocNo,
  formatBatchCoaDocNo,
  formatBatchMoaDocNo,
  formatBatchSpecDocNo,
} from "../../utils/doc-number";
import { generateArn } from "../../services/arn-generator";
import { batchLink } from "../../services/notification-links";
import { notify } from "../../services/notification.service";
import * as authRepo from "../auth/auth.repository";
import * as batchesRepo from "./batches.repository";
import * as specTemplatesRepo from "../spec-templates/spec-templates.repository";
import { CreateBatchBody, ListBatchesQuery } from "./batches.schema";
import {
  BatchDetailDto,
  BatchDocumentDto,
  BatchDto,
  BatchListItemDto,
  CreateBatchResultDto,
} from "./batches.types";

function toBatchDto(batch: Prisma.BatchGetPayload<object>): BatchDto {
  return {
    id: batch.id,
    productId: batch.productId,
    productMasterId: batch.productMasterId,
    specTemplateId: batch.specTemplateId,
    batchNo: batch.batchNo,
    arn: batch.arn,
    mfgDateMonth: batch.mfgDateMonth,
    mfgDateYear: batch.mfgDateYear,
    expiryDate: batch.expiryDate,
    batchSize: batch.batchSize?.toString() ?? null,
    batchSizeUom: batch.batchSizeUom,
    qtySampled: batch.qtySampled?.toString() ?? null,
    qtySampledUom: batch.qtySampledUom,
    customerName: batch.customerName,
    customerRef: batch.customerRef,
    customerSpecialInstructions: batch.customerSpecialInstructions,
    currentDocPhase: batch.currentDocPhase,
    status: batch.status,
    assignedQcExecId: batch.assignedQcExecId,
    createdById: batch.createdById,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}

function toDocumentDto(doc: Prisma.BatchDocumentGetPayload<object>): BatchDocumentDto {
  return {
    id: doc.id,
    batchId: doc.batchId,
    docType: doc.docType,
    docNo: doc.docNo,
    status: doc.status,
    sourceTemplateId: doc.sourceTemplateId,
    sourceMasterId: doc.sourceMasterId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function validateAssignee(assignedQcExecId: string): Promise<void> {
  const user = await authRepo.findActiveQcExec(assignedQcExecId);
  if (!user) {
    throw AppError.invalidAssignee();
  }
}

async function loadTemplateForCreate(specTemplateId: string, productId: string) {
  const template = await batchesRepo.findTemplateByIdWithProduct(specTemplateId);

  if (!template) {
    throw AppError.notFound("Spec template");
  }

  if (template.productId !== productId) {
    throw AppError.validation("Spec template does not belong to the specified product");
  }

  if (template.status !== TemplateStatus.QA_SIGNED) {
    throw AppError.templateNotSigned();
  }

  return template;
}

export async function listBatches(query: ListBatchesQuery) {
  const { page, limit, skip, take } = parsePagination(query as Record<string, unknown>);

  const where: Prisma.BatchWhereInput = {};

  if (query.status) {
    where.status = query.status;
  }
  if (query.product) {
    where.productId = query.product;
  }
  if (query.assignedTo) {
    where.assignedQcExecId = query.assignedTo;
  }

  const [items, total] = await Promise.all([
    batchesRepo.findManyBatches(where, skip, take),
    batchesRepo.countBatches(where),
  ]);

  const mapped: BatchListItemDto[] = items.map((batch) => ({
    ...toBatchDto(batch),
    product: batch.product,
    assignedQcExec: batch.assignedQcExec,
  }));

  return { items: mapped, total, page, limit };
}

export async function createBatch(
  body: CreateBatchBody,
  actor: JwtAccessPayload,
): Promise<CreateBatchResultDto> {
  const template = await loadTemplateForCreate(body.specTemplateId, body.productId);
  await validateAssignee(body.assignedQcExecId);

  const productCode = template.product.code;
  const expiryDate = computeBatchExpiryDate(
    body.mfgMonth,
    body.mfgYear,
    template.product.shelfLifeMonths,
  );

  const docFormats = {
    spec: formatBatchSpecDocNo({ productCode, batchNo: body.batchNo }),
    moa: formatBatchMoaDocNo({ productCode, batchNo: body.batchNo }),
    aws: formatBatchAwsDocNo({ productCode, batchNo: body.batchNo }),
    coa: formatBatchCoaDocNo({ productCode, batchNo: body.batchNo }),
  };

  const result = await prisma.$transaction(async (tx) => {
    const { arn } = await generateArn(tx);

    const batch = await batchesRepo.createBatch(
      {
        product: { connect: { id: body.productId } },
        productMaster: { connect: { id: template.sourceMasterId } },
        specTemplate: { connect: { id: body.specTemplateId } },
        batchNo: body.batchNo,
        arn,
        mfgDateMonth: body.mfgMonth,
        mfgDateYear: body.mfgYear,
        expiryDate,
        batchSize: body.batchSize,
        batchSizeUom: body.batchSizeUom,
        qtySampled: body.qtySampled,
        qtySampledUom: body.qtySampledUom,
        customerName: body.customerName,
        customerRef: body.customerRef,
        customerSpecialInstructions: body.customerSpecialInstructions,
        currentDocPhase: DocPhase.SPEC,
        status: BatchStatus.ACTIVE,
        assignedQcExec: { connect: { id: body.assignedQcExecId } },
        createdBy: { connect: { id: actor.userId } },
      },
      tx,
    );

    const documents = await Promise.all([
      batchesRepo.createBatchDocument(
        {
          batch: { connect: { id: batch.id } },
          docType: DocType.SPEC,
          docNo: docFormats.spec,
          status: DocStatus.PENDING,
          sourceTemplate: { connect: { id: template.id } },
          sourceMaster: { connect: { id: template.sourceMasterId } },
          optionalTestsActivated: [],
        },
        tx,
      ),
      batchesRepo.createBatchDocument(
        {
          batch: { connect: { id: batch.id } },
          docType: DocType.MOA,
          docNo: docFormats.moa,
          status: DocStatus.PENDING,
          optionalTestsActivated: [],
        },
        tx,
      ),
      batchesRepo.createBatchDocument(
        {
          batch: { connect: { id: batch.id } },
          docType: DocType.AWS,
          docNo: docFormats.aws,
          status: DocStatus.PENDING,
          optionalTestsActivated: [],
        },
        tx,
      ),
      batchesRepo.createBatchDocument(
        {
          batch: { connect: { id: batch.id } },
          docType: DocType.COA,
          docNo: docFormats.coa,
          status: DocStatus.PENDING,
          optionalTestsActivated: [],
        },
        tx,
      ),
    ]);

    return { batch, documents };
  });

  await notify({
    recipients: { users: [body.assignedQcExecId] },
    type: "BATCH_ASSIGNED",
    title: "Batch assignment",
    message: `You've been assigned to batch ${result.batch.arn}.`,
    link: batchLink(result.batch.id),
    excludeUserId: actor.userId,
  });

  return {
    batch: toBatchDto(result.batch),
    documents: result.documents.map(toDocumentDto),
  };
}

export async function getBatchById(batchId: string): Promise<BatchDetailDto> {
  const batch = await batchesRepo.findBatchById(batchId);

  if (!batch) {
    throw AppError.notFound("Batch");
  }

  return {
    ...toBatchDto(batch),
    documents: batch.batchDocuments.map(toDocumentDto),
    product: batch.product,
    specTemplate: {
      id: batch.specTemplate.id,
      templateNo: batch.specTemplate.templateNo,
      variantType: batch.specTemplate.variantType,
      status: batch.specTemplate.status,
      sourceMasterId: batch.specTemplate.sourceMasterId,
    },
    productMaster: batch.productMaster,
    assignedQcExec: batch.assignedQcExec,
    workflowHistory: [],
  };
}

export async function getAssigneeName(userId: string): Promise<string | undefined> {
  const user = await authRepo.findUserFullName(userId);
  return user?.fullName;
}

export async function getTemplateNo(templateId: string): Promise<string | undefined> {
  const template = await specTemplatesRepo.findTemplateNo(templateId);
  return template?.templateNo;
}
