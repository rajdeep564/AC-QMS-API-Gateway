import { Prisma } from "@prisma/client";
import { Db, prisma } from "../../lib/prisma-types";

export const awsSectionInclude = {
  specDocumentTest: true,
  instrument: {
    select: {
      id: true,
      instrumentId: true,
      name: true,
      useBefore: true,
    },
  },
  reagent: {
    select: {
      id: true,
      name: true,
      lotNo: true,
      expiryDate: true,
    },
  },
  analyst: { select: { id: true, fullName: true } },
  checker: { select: { id: true, fullName: true } },
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
          status: true,
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
    select: { id: true, docType: true, status: true, docNo: true, batchId: true },
  });
}

export async function findAwsSectionsByDocumentId(awsDocId: string, client: Db = prisma) {
  return client.awsSection.findMany({
    where: { batchDocumentId: awsDocId },
    include: awsSectionInclude,
    orderBy: { specDocumentTest: { sortOrder: "asc" } },
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
    select: { id: true, instrumentId: true, name: true, useBefore: true },
  });
}

export async function findReagentById(reagentId: string, client: Db = prisma) {
  return client.reagent.findUnique({
    where: { id: reagentId },
    select: { id: true, name: true, lotNo: true, expiryDate: true },
  });
}
