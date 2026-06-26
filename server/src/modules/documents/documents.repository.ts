import { DocType, Prisma } from "@prisma/client";
import { Db, prisma } from "../../lib/prisma-types";

export async function findBatchForSpecPopulate(batchId: string, client: Db = prisma) {
  return client.batch.findUnique({
    where: { id: batchId },
    include: {
      specTemplate: {
        include: {
          specTemplateTests: {
            include: { testParameter: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      },
      batchDocuments: {
        where: { docType: DocType.SPEC },
      },
    },
  });
}

export async function findDocumentDetail(documentId: string, client: Db = prisma) {
  return client.batchDocument.findUnique({
    where: { id: documentId },
    include: {
      specDocumentTests: { orderBy: { sortOrder: "asc" } },
      moaDocumentSections: { orderBy: { sortOrder: "asc" } },
      coaResults: { orderBy: { sortOrder: "asc" } },
      batch: { select: { assignedQcExecId: true } },
    },
  });
}

export async function deleteSpecDocumentTests(batchDocumentId: string, client: Db = prisma) {
  return client.specDocumentTest.deleteMany({ where: { batchDocumentId } });
}

export async function createSpecDocumentTests(
  data: Prisma.SpecDocumentTestCreateManyInput[],
  client: Db = prisma,
) {
  if (data.length === 0) return;
  return client.specDocumentTest.createMany({ data });
}

export async function updateOptionalTestsActivated(
  documentId: string,
  optionalTestIds: string[],
  client: Db = prisma,
) {
  return client.batchDocument.update({
    where: { id: documentId },
    data: { optionalTestsActivated: optionalTestIds },
  });
}
