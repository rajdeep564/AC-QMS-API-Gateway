import { DocType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma-types";
import type { DocumentAccessScope } from "./document-access";

export type ExplorerQueryFilters = {
  productId?: string;
  batchId?: string;
  docType?: "SPEC" | "MOA" | "AWS" | "COA";
};

export type RawAttachmentRef = {
  id: string;
  createdAt: Date;
  filePath: string;
};

export type RawExplorerProduct = {
  id: string;
  name: string;
  specs: Array<{
    id: string;
    specNo: string;
    status: string;
    createdAt: Date;
    approvedAt: Date | null;
    attachments: RawAttachmentRef[];
    moaDoc: {
      id: string;
      moaNo: string;
      status: string;
      createdAt: Date;
    } | null;
  }>;
  batches: Array<{
    id: string;
    batchNo: string;
    status: string;
    assignedQcExecId: string | null;
    createdAt: Date;
    batchDocuments: Array<{
      id: string;
      docType: DocType;
      docNo: string;
      status: string;
      createdAt: Date;
      attachments: RawAttachmentRef[];
    }>;
  }>;
};

/**
 * Load products + standing docs + batches for explorer, already scoped by access.
 * Filters only narrow; they never widen.
 */
export async function loadExplorerTree(
  scope: DocumentAccessScope,
  filters: ExplorerQueryFilters,
): Promise<RawExplorerProduct[]> {
  const productWhere: Prisma.ProductWhereInput = {};

  if (filters.productId) {
    productWhere.id = filters.productId;
  }

  if (scope.mode === "assigned") {
    productWhere.batches = { some: { assignedQcExecId: scope.userId } };
    // If productId filter is outside assignment, the some-clause yields empty — correct.
  }

  const batchWhere: Prisma.BatchWhereInput = {};
  if (filters.batchId) {
    batchWhere.id = filters.batchId;
  }
  if (scope.mode === "assigned") {
    batchWhere.assignedQcExecId = scope.userId;
  }

  const products = await prisma.product.findMany({
    where: productWhere,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      specs: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          specNo: true,
          status: true,
          createdAt: true,
          approvedAt: true,
          attachments: {
            where: { fileType: "DOCX" },
            orderBy: { createdAt: "desc" },
            select: { id: true, createdAt: true, filePath: true },
          },
          moaDoc: {
            select: {
              id: true,
              moaNo: true,
              status: true,
              createdAt: true,
            },
          },
        },
      },
      batches: {
        where: batchWhere,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          batchNo: true,
          status: true,
          assignedQcExecId: true,
          createdAt: true,
          batchDocuments: {
            where: {
              docType: { in: [DocType.AWS, DocType.COA] },
            },
            select: {
              id: true,
              docType: true,
              docNo: true,
              status: true,
              createdAt: true,
              attachments: {
                where: { fileType: "DOCX" },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { id: true, createdAt: true, filePath: true },
              },
            },
          },
        },
      },
    },
  });

  return products;
}
