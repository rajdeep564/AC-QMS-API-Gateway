import {
  BatchStatus,
  DocStatus,
  DocType,
  Prisma,
  SectionStatus,
} from "@prisma/client";
import { Db, prisma } from "../../lib/prisma-types";
import { generateArn } from "../../services/arn-generator";
import { formatBatchAwsDocNo, formatBatchCoaDocNo } from "../../utils/batch-doc-number";
import { AppError } from "../../lib/app-error";

const batchDetailInclude = {
  product: true,
  sourceSpec: { select: { id: true, specNo: true, revisionNo: true, status: true } },
  assignedQcExec: { select: { id: true, fullName: true, username: true } },
  createdBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  specDocTests: { orderBy: { sortOrder: "asc" as const } },
  moaDocSections: {
    include: { specDocumentTest: { select: { id: true, testName: true, sortOrder: true } } },
  },
  batchDocuments: {
    include: {
      awsSections: {
        include: { specDocumentTest: true },
        orderBy: { specDocumentTest: { sortOrder: "asc" } },
      },
      coaResults: { orderBy: { sortOrder: "asc" } },
    },
  },
} satisfies Prisma.BatchInclude;

export type BatchWithDetails = Prisma.BatchGetPayload<{ include: typeof batchDetailInclude }>;

export type CreateBatchInput = {
  productId: string;
  sourceSpecId: string;
  batchNo: string;
  productCode: string;
  createdById: string;
  assignedQcExecId: string;
  mfgDate?: Date;
  expDate?: Date;
  batchSize?: string;
};

export type SpecTestSnapshot = {
  sourceSpecTestId: string;
  testName: string;
  resultType: Prisma.SpecDocumentTestCreateInput["resultType"];
  operator?: Prisma.SpecDocumentTestCreateInput["operator"];
  minValue?: Prisma.Decimal | null;
  maxValue?: Prisma.Decimal | null;
  uom?: string | null;
  acceptanceCriteria?: string | null;
  formula?: string | null;
  sortOrder: number;
};

export type MoaSectionSnapshot = {
  sourceMoaSectionId: string;
  sourceSpecTestId: string;
  procedureSnapshot: string;
};

async function assertBatchStatusMutationAllowed(
  batchId: string,
  toStatus: BatchStatus,
  client: Db,
): Promise<void> {
  const batch = await client.batch.findUnique({ where: { id: batchId } });
  if (!batch) {
    throw AppError.notFound("Batch");
  }
  if (batch.status === BatchStatus.APPROVED || batch.status === BatchStatus.RELEASED) {
    const releaseOnly =
      batch.status === BatchStatus.APPROVED && toStatus === BatchStatus.RELEASED;
    if (!releaseOnly) {
      throw AppError.conflict("Batch is locked and cannot be modified");
    }
  }
}

export async function findBatchById(batchId: string, client: Db = prisma) {
  return client.batch.findUnique({ where: { id: batchId } });
}

export async function findBatchWithDetails(batchId: string, client: Db = prisma) {
  return client.batch.findUnique({
    where: { id: batchId },
    include: batchDetailInclude,
  });
}

export async function listBatches(
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
      product: { select: { id: true, name: true } },
      assignedQcExec: { select: { id: true, fullName: true } },
      batchDocuments: { select: { id: true, docType: true, status: true, docNo: true } },
    },
  });
}

export async function countBatches(where: Prisma.BatchWhereInput, client: Db = prisma) {
  return client.batch.count({ where });
}

export async function findSpecDocumentTestsByBatchId(batchId: string, client: Db = prisma) {
  return client.specDocumentTest.findMany({
    where: { batchId },
    orderBy: { sortOrder: "asc" },
  });
}

export async function findBatchDocumentById(documentId: string, client: Db = prisma) {
  return client.batchDocument.findUnique({
    where: { id: documentId },
    include: { batch: true },
  });
}

export async function findBatchDocumentByType(
  batchId: string,
  docType: DocType,
  client: Db = prisma,
) {
  return client.batchDocument.findFirst({
    where: { batchId, docType },
  });
}

export async function findBatchDocumentWithDetails(documentId: string, client: Db = prisma) {
  return client.batchDocument.findUnique({
    where: { id: documentId },
    include: {
      batch: true,
      awsSections: {
        include: { specDocumentTest: true },
        orderBy: { specDocumentTest: { sortOrder: "asc" } },
      },
      coaResults: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function updateBatchStatus(
  batchId: string,
  data: { status: BatchStatus; approvedById?: string },
  client: Db = prisma,
) {
  await assertBatchStatusMutationAllowed(batchId, data.status, client);
  return client.batch.update({
    where: { id: batchId },
    data: {
      status: data.status,
      approvedById: data.approvedById,
    },
  });
}

export async function updateBatchDocumentStatus(
  documentId: string,
  status: DocStatus,
  client: Db = prisma,
  extra?: Prisma.BatchDocumentUpdateInput,
) {
  return client.batchDocument.update({
    where: { id: documentId },
    data: { status, ...extra },
  });
}

export async function updateBatchDocumentWorkflow(
  documentId: string,
  data: {
    status: DocStatus;
    submittedById?: string | null;
    qcApprovedById?: string | null;
    qaSignedById?: string | null;
    complianceVerdict?: Prisma.BatchDocumentUpdateInput["complianceVerdict"];
    createdById?: string | null;
  },
  client: Db = prisma,
) {
  return client.batchDocument.update({
    where: { id: documentId },
    data,
  });
}

export async function deleteAwsSectionsForDocument(documentId: string, client: Db = prisma) {
  return client.awsSection.deleteMany({ where: { batchDocumentId: documentId } });
}

export async function createAwsSections(
  sections: {
    batchDocumentId: string;
    specDocumentTestId: string;
    status: SectionStatus;
  }[],
  client: Db = prisma,
) {
  if (sections.length === 0) return;
  return client.awsSection.createMany({ data: sections });
}

export async function allAwsSectionsComplete(documentId: string, client: Db = prisma) {
  const sections = await client.awsSection.findMany({
    where: { batchDocumentId: documentId },
    select: { status: true },
  });
  if (sections.length === 0) return false;
  return sections.every((s) => s.status === SectionStatus.COMPLETE);
}

export async function findAwsSectionsForCoa(documentId: string, client: Db = prisma) {
  return client.awsSection.findMany({
    where: { batchDocumentId: documentId, status: SectionStatus.COMPLETE },
    include: { specDocumentTest: true },
    orderBy: { specDocumentTest: { sortOrder: "asc" } },
  });
}

export async function deleteCoaResults(documentId: string, client: Db = prisma) {
  return client.coaResult.deleteMany({ where: { batchDocumentId: documentId } });
}

export async function createCoaResults(
  results: Prisma.CoaResultCreateManyInput[],
  client: Db = prisma,
) {
  if (results.length === 0) return;
  return client.coaResult.createMany({ data: results });
}

export async function findPendingCoaDocument(batchId: string, client: Db = prisma) {
  return client.batchDocument.findFirst({
    where: { batchId, docType: DocType.COA, status: DocStatus.PENDING },
  });
}

/** US-13-1/2 — idempotent auto-gen guard: COA already populated for batch. */
export async function findExistingCoaDocument(batchId: string, client: Db = prisma) {
  return client.batchDocument.findFirst({
    where: {
      batchId,
      docType: DocType.COA,
      status: { in: [DocStatus.AUTO_GENERATED, DocStatus.ISSUED] },
    },
  });
}

export async function findPendingAwsDocument(batchId: string, client: Db = prisma) {
  return client.batchDocument.findFirst({
    where: { batchId, docType: DocType.AWS, status: DocStatus.PENDING },
  });
}

export async function transitionCoaDocumentToAutoGenerated(
  coaDocId: string,
  data: {
    complianceVerdict: Prisma.BatchDocumentUpdateInput["complianceVerdict"];
    createdById?: string | null;
    qcApprovedById?: string | null;
    qaSignedById?: string | null;
  },
  client: Db = prisma,
) {
  return client.batchDocument.update({
    where: { id: coaDocId },
    data: {
      status: DocStatus.AUTO_GENERATED,
      complianceVerdict: data.complianceVerdict,
      createdById: data.createdById,
      qcApprovedById: data.qcApprovedById,
      qaSignedById: data.qaSignedById,
    },
  });
}

export async function transitionCoaDocumentToIssued(
  coaDocId: string,
  qaSignedById: string,
  client: Db = prisma,
) {
  return client.batchDocument.update({
    where: { id: coaDocId },
    data: { status: DocStatus.ISSUED, qaSignedById },
  });
}

export async function releaseBatch(batchId: string, client: Db = prisma) {
  await assertBatchStatusMutationAllowed(batchId, BatchStatus.RELEASED, client);
  return client.batch.update({
    where: { id: batchId },
    data: { status: BatchStatus.RELEASED, releasedAt: new Date() },
  });
}

export async function createBatchWithSnapshot(
  input: CreateBatchInput,
  specTests: SpecTestSnapshot[],
  moaSections: MoaSectionSnapshot[],
  client: Db = prisma,
) {
  const run = async (tx: Db) => {
    const { arn } = await generateArn(tx as Prisma.TransactionClient);

    const batch = await tx.batch.create({
      data: {
        productId: input.productId,
        sourceSpecId: input.sourceSpecId,
        batchNo: input.batchNo,
        arnNo: arn,
        assignedQcExecId: input.assignedQcExecId,
        status: BatchStatus.DRAFT,
        mfgDate: input.mfgDate,
        expDate: input.expDate,
        batchSize: input.batchSize,
        createdById: input.createdById,
      },
    });

    const testIdBySource = new Map<string, string>();

    for (const test of specTests) {
      const row = await tx.specDocumentTest.create({
        data: {
          batchId: batch.id,
          sourceSpecTestId: test.sourceSpecTestId,
          testName: test.testName,
          resultType: test.resultType,
          operator: test.operator ?? null,
          minValue: test.minValue ?? null,
          maxValue: test.maxValue ?? null,
          uom: test.uom ?? null,
          acceptanceCriteria: test.acceptanceCriteria ?? null,
          formula: test.formula ?? null,
          sortOrder: test.sortOrder,
        },
      });
      testIdBySource.set(test.sourceSpecTestId, row.id);
    }

    for (const section of moaSections) {
      const specDocumentTestId = testIdBySource.get(section.sourceSpecTestId);
      if (!specDocumentTestId) continue;
      await tx.moaDocumentSection.create({
        data: {
          batchId: batch.id,
          sourceMoaSectionId: section.sourceMoaSectionId,
          specDocumentTestId,
          procedureSnapshot: section.procedureSnapshot,
        },
      });
    }

    await tx.batchDocument.createMany({
      data: [
        {
          batchId: batch.id,
          docType: DocType.AWS,
          docNo: formatBatchAwsDocNo(input.batchNo),
          status: DocStatus.PENDING,
        },
        {
          batchId: batch.id,
          docType: DocType.COA,
          docNo: formatBatchCoaDocNo({
            productCode: input.productCode,
            batchNo: input.batchNo,
          }),
          status: DocStatus.PENDING,
        },
      ],
    });

    return findBatchWithDetails(batch.id, tx);
  };

  if ("$transaction" in client && typeof client.$transaction === "function") {
    return (client as typeof prisma).$transaction(run);
  }
  return run(client);
}
