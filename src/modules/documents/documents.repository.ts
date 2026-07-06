import { Prisma } from "@prisma/client";
import { Db, prisma } from "../../lib/prisma-types";

const documentDetailInclude = {
  batch: {
    select: {
      id: true,
      batchNo: true,
      arnNo: true,
      status: true,
      assignedQcExecId: true,
      createdById: true,
    },
  },
  awsSections: {
    include: { specDocumentTest: true },
    orderBy: { specDocumentTest: { sortOrder: "asc" } },
  },
  coaResults: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.BatchDocumentInclude;

export type DocumentDetail = Prisma.BatchDocumentGetPayload<{
  include: typeof documentDetailInclude;
}>;

export async function findDocumentDetail(documentId: string, client: Db = prisma) {
  return client.batchDocument.findUnique({
    where: { id: documentId },
    include: documentDetailInclude,
  });
}
