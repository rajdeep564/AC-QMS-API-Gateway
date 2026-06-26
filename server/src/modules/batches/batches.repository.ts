import {
  BatchStatus,
  DocPhase,
  DocStatus,
  DocType,
  Prisma,
  SectionStatus,
} from "@prisma/client";
import { Db, prisma } from "../../lib/prisma-types";

export async function findTemplateByIdWithProduct(specTemplateId: string, client: Db = prisma) {
  return client.specTemplate.findUnique({
    where: { id: specTemplateId },
    include: { product: true },
  });
}

export async function findManyBatches(
  where: Prisma.BatchWhereInput,
  skip: number,
  take: number,
  client: Db = prisma,
) {
  return client.batch.findMany({
    where,
    skip,
    take,
    orderBy: { createdAt: "desc" },
    include: {
      product: { select: { id: true, name: true, code: true, shelfLifeMonths: true } },
      assignedQcExec: { select: { id: true, fullName: true, username: true, role: true } },
    },
  });
}

export async function countBatches(where: Prisma.BatchWhereInput, client: Db = prisma) {
  return client.batch.count({ where });
}

export async function createBatch(data: Prisma.BatchCreateInput, client: Db = prisma) {
  return client.batch.create({ data });
}

export async function createBatchDocument(
  data: Prisma.BatchDocumentCreateInput,
  client: Db = prisma,
) {
  return client.batchDocument.create({ data });
}

export async function findBatchById(batchId: string, client: Db = prisma) {
  return client.batch.findUnique({
    where: { id: batchId },
    include: {
      batchDocuments: { orderBy: { docType: "asc" } },
      product: { select: { id: true, name: true, code: true, shelfLifeMonths: true } },
      specTemplate: {
        select: {
          id: true,
          templateNo: true,
          variantType: true,
          status: true,
          sourceMasterId: true,
        },
      },
      productMaster: { select: { id: true, revisionNo: true, status: true } },
      assignedQcExec: { select: { id: true, fullName: true, username: true, role: true } },
    },
  });
}

// --- Shared batch-document methods (Option B) ---

export async function findBatchDocumentWithBatch(documentId: string, client: Db = prisma) {
  return client.batchDocument.findUnique({
    where: { id: documentId },
    include: { batch: { select: { assignedQcExecId: true } } },
  });
}

export async function findBatchDocumentById(documentId: string, client: Db = prisma) {
  return client.batchDocument.findUnique({ where: { id: documentId } });
}

export async function updateBatchDocument(
  documentId: string,
  data: Prisma.BatchDocumentUpdateInput,
  client: Db = prisma,
) {
  return client.batchDocument.update({ where: { id: documentId }, data });
}

export async function countSpecDocumentTests(batchDocumentId: string, client: Db = prisma) {
  return client.specDocumentTest.count({ where: { batchDocumentId } });
}

export async function transitionBatchDocumentToDraft(
  documentId: string,
  options?: { createdById?: string },
  client: Db = prisma,
) {
  return client.batchDocument.update({
    where: { id: documentId },
    data: {
      status: DocStatus.DRAFT,
      ...(options?.createdById ? { createdById: options.createdById } : {}),
    },
  });
}

export async function findPendingMoaDocument(batchId: string, client: Db = prisma) {
  return client.batchDocument.findFirst({
    where: { batchId, docType: DocType.MOA, status: DocStatus.PENDING },
  });
}

export async function findPendingAwsDocument(batchId: string, client: Db = prisma) {
  return client.batchDocument.findFirst({
    where: { batchId, docType: DocType.AWS, status: DocStatus.PENDING },
  });
}

export async function findSpecDocumentByBatchId(batchId: string, client: Db = prisma) {
  return client.batchDocument.findFirst({
    where: { batchId, docType: DocType.SPEC },
    include: {
      specDocumentTests: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function findBatchByIdForNotification(batchId: string, client: Db = prisma) {
  return client.batch.findUnique({
    where: { id: batchId },
    select: { batchNo: true, assignedQcExecId: true },
  });
}

export async function findSpecDocumentTests(batchDocumentId: string, client: Db = prisma) {
  return client.specDocumentTest.findMany({
    where: { batchDocumentId },
    orderBy: { sortOrder: "asc" },
  });
}

export async function findBatchDocumentSourceMaster(
  documentId: string,
  client: Db = prisma,
) {
  return client.batchDocument.findUnique({
    where: { id: documentId },
    select: { sourceMasterId: true },
  });
}

export async function deleteMoaDocumentSections(batchDocumentId: string, client: Db = prisma) {
  return client.moaDocumentSection.deleteMany({ where: { batchDocumentId } });
}

export async function createMoaDocumentSections(
  data: Prisma.MoaDocumentSectionCreateManyInput[],
  client: Db = prisma,
) {
  if (data.length === 0) return;
  return client.moaDocumentSection.createMany({ data });
}

export async function updateBatchPhase(batchId: string, phase: DocPhase, client: Db = prisma) {
  return client.batch.update({
    where: { id: batchId },
    data: { currentDocPhase: phase },
    select: { assignedQcExecId: true },
  });
}

export async function countMoaDocumentSections(batchDocumentId: string, client: Db = prisma) {
  return client.moaDocumentSection.count({ where: { batchDocumentId } });
}

export async function deleteAwsSections(batchDocumentId: string, client: Db = prisma) {
  return client.awsSection.deleteMany({ where: { batchDocumentId } });
}

export async function createAwsSections(
  data: Prisma.AwsSectionCreateManyInput[],
  client: Db = prisma,
) {
  if (data.length === 0) return;
  return client.awsSection.createMany({ data });
}

export async function countAwsSections(batchDocumentId: string, client: Db = prisma) {
  return client.awsSection.count({ where: { batchDocumentId } });
}

export async function allAwsSectionsComplete(
  batchDocumentId: string,
  client: Db = prisma,
): Promise<boolean> {
  const total = await client.awsSection.count({ where: { batchDocumentId } });
  if (total === 0) return false;
  const completed = await client.awsSection.count({
    where: { batchDocumentId, status: SectionStatus.COMPLETED },
  });
  return completed === total;
}

export async function findPendingCoaDocument(batchId: string, client: Db = prisma) {
  return client.batchDocument.findFirst({
    where: { batchId, docType: DocType.COA, status: DocStatus.PENDING },
  });
}

export async function findBatchDocumentWithWorkflowFields(
  documentId: string,
  client: Db = prisma,
) {
  return client.batchDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      batchId: true,
      docType: true,
      docNo: true,
      status: true,
      submittedById: true,
      qcApprovedById: true,
      qaSignedById: true,
    },
  });
}

export async function findAwsSectionsForCoaGeneration(
  awsBatchDocumentId: string,
  client: Db = prisma,
) {
  return client.awsSection.findMany({
    where: { batchDocumentId: awsBatchDocumentId },
    orderBy: { sortOrder: "asc" },
    include: {
      specDocumentTest: true,
      testParameter: { select: { testName: true, resultType: true } },
    },
  });
}

export async function deleteCoaResults(batchDocumentId: string, client: Db = prisma) {
  return client.coaResult.deleteMany({ where: { batchDocumentId } });
}

export async function createCoaResults(
  data: Prisma.CoaResultCreateManyInput[],
  client: Db = prisma,
) {
  if (data.length === 0) return;
  return client.coaResult.createMany({ data });
}

export async function transitionCoaDocumentToAutoGenerated(
  coaDocumentId: string,
  data: {
    complianceVerdict: Prisma.BatchDocumentUpdateInput["complianceVerdict"];
    createdById: string | null;
    qcApprovedById: string | null;
    qaSignedById: string | null;
  },
  client: Db = prisma,
) {
  return client.batchDocument.update({
    where: { id: coaDocumentId },
    data: {
      status: DocStatus.AUTO_GENERATED,
      complianceVerdict: data.complianceVerdict,
      createdById: data.createdById,
      qcApprovedById: data.qcApprovedById,
      qaSignedById: data.qaSignedById,
    },
  });
}

export async function transitionCoaDocumentToIssued(coaDocumentId: string, client: Db = prisma) {
  return client.batchDocument.update({
    where: { id: coaDocumentId },
    data: { status: DocStatus.ISSUED },
  });
}

export async function releaseBatch(batchId: string, client: Db = prisma) {
  return client.batch.update({
    where: { id: batchId },
    data: {
      status: BatchStatus.RELEASED,
      releasedAt: new Date(),
      currentDocPhase: DocPhase.RELEASED,
    },
    select: { id: true, batchNo: true, arn: true, assignedQcExecId: true },
  });
}

export async function findBatchDocumentWithTests(
  documentId: string,
  client: Db = prisma,
) {
  return client.batchDocument.findUnique({
    where: { id: documentId },
    include: {
      specDocumentTests: true,
      batch: { select: { assignedQcExecId: true } },
    },
  });
}
