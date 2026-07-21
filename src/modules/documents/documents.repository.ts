import { DocStatus, DocType, Prisma, Role } from "@prisma/client";
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
  createdBy: { select: { id: true, fullName: true } },
  submittedBy: { select: { id: true, fullName: true } },
  qcApprovedBy: { select: { id: true, fullName: true } },
  qaSignedBy: { select: { id: true, fullName: true } },
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

export async function listSubmittedAwsForQcApproval(client: Db = prisma) {
  return client.batchDocument.findMany({
    where: { docType: DocType.AWS, status: DocStatus.SUBMITTED },
    orderBy: { createdAt: "desc" },
    include: {
      batch: {
        select: {
          id: true,
          batchNo: true,
          productId: true,
          assignedQcExecId: true,
          product: { select: { id: true, name: true } },
          assignedQcExec: { select: { fullName: true } },
        },
      },
      submittedBy: { select: { username: true, fullName: true } },
    },
  });
}
