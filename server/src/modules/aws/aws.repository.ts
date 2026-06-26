import { Prisma } from "@prisma/client";
import { Db, prisma } from "../../lib/prisma-types";

export const awsSectionInclude = {
  specDocumentTest: true,
  testParameter: {
    select: {
      id: true,
      testName: true,
      resultType: true,
      calculationFormula: true,
      formulaVariables: true,
      uom: true,
    },
  },
  instrument: {
    select: {
      id: true,
      instrumentCode: true,
      name: true,
      useBeforeDate: true,
      status: true,
    },
  },
  analyzedBy: {
    select: { id: true, fullName: true },
  },
  checkedBy: {
    select: { id: true, fullName: true },
  },
  batchDocument: {
    select: {
      id: true,
      docType: true,
      status: true,
      docNo: true,
      batchId: true,
      batch: {
        select: {
          assignedQcExecId: true,
          batchNo: true,
        },
      },
    },
  },
} satisfies Prisma.AwsSectionInclude;

export type AwsSectionDetail = Prisma.AwsSectionGetPayload<{
  include: typeof awsSectionInclude;
}>;

export async function findAwsDocumentById(awsDocId: string, client: Db = prisma) {
  return client.batchDocument.findUnique({
    where: { id: awsDocId },
    select: { id: true, docType: true, status: true, docNo: true },
  });
}

export async function findAwsSectionsByDocumentId(awsDocId: string, client: Db = prisma) {
  return client.awsSection.findMany({
    where: { batchDocumentId: awsDocId },
    include: awsSectionInclude,
    orderBy: { sortOrder: "asc" },
  });
}

export async function findAwsSectionById(sectionId: string, client: Db = prisma) {
  return client.awsSection.findUnique({
    where: { id: sectionId },
    include: awsSectionInclude,
  });
}

export async function updateAwsSection(
  sectionId: string,
  data: Prisma.AwsSectionUpdateInput,
  client: Db = prisma,
) {
  return client.awsSection.update({
    where: { id: sectionId },
    data,
    include: awsSectionInclude,
  });
}

export async function findInstrumentById(instrumentId: string, client: Db = prisma) {
  return client.instrument.findUnique({
    where: { id: instrumentId },
    select: {
      id: true,
      instrumentCode: true,
      name: true,
      useBeforeDate: true,
      status: true,
    },
  });
}

export async function findReagentById(reagentId: string, client: Db = prisma) {
  return client.reagent.findUnique({
    where: { id: reagentId },
    select: {
      id: true,
      name: true,
      lotNo: true,
      expiryDate: true,
      status: true,
    },
  });
}

export async function findReagentsByIds(reagentIds: string[], client: Db = prisma) {
  if (reagentIds.length === 0) return [];
  return client.reagent.findMany({
    where: { id: { in: reagentIds } },
    select: {
      id: true,
      name: true,
      lotNo: true,
      expiryDate: true,
      status: true,
    },
  });
}

export async function findInstrumentByCode(instrumentCode: string, client: Db = prisma) {
  return client.instrument.findUnique({
    where: { instrumentCode },
    select: { id: true, instrumentCode: true },
  });
}

export async function findReagentByLotNo(lotNo: string, client: Db = prisma) {
  return client.reagent.findFirst({
    where: { lotNo },
    select: { id: true, lotNo: true },
  });
}
