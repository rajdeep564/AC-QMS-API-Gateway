import {
  BatchStatus,
  DocStatus,
  DocType,
  Prisma,
} from "@prisma/client";
import type { Db } from "../../lib/prisma-types";
import { prisma } from "../../lib/prisma-types";
import type { ListMarketingDocumentsQuery } from "./marketing.schema";

export type MarketingDocumentFilters = Pick<
  ListMarketingDocumentsQuery,
  "product" | "customer" | "type" | "search"
>;

export type MarketingPagination = {
  skip: number;
  take: number;
};

/** Documents visible to Marketing — enforced in every query where clause. */
export function marketingDocumentWhere(
  extra?: Prisma.BatchDocumentWhereInput,
): Prisma.BatchDocumentWhereInput {
  return {
    batch: { status: BatchStatus.RELEASED },
    OR: [
      { docType: { not: DocType.COA } },
      { docType: DocType.COA, status: DocStatus.ISSUED },
    ],
    ...extra,
  };
}

function buildMarketingDocumentFilters(
  filters: MarketingDocumentFilters,
): Prisma.BatchDocumentWhereInput {
  const and: Prisma.BatchDocumentWhereInput[] = [];

  if (filters.product) {
    and.push({ batch: { productId: filters.product } });
  }

  if (filters.customer) {
    // Customer fields are not on Batch in Rev 2.3.1 — ignore filter until C-legacy columns exist.
  }

  if (filters.type) {
    and.push({ docType: filters.type });
  }

  if (filters.search) {
    and.push({
      OR: [
        { docNo: { contains: filters.search, mode: "insensitive" } },
        { batch: { batchNo: { contains: filters.search, mode: "insensitive" } } },
        {
          batch: {
            product: { name: { contains: filters.search, mode: "insensitive" } },
          },
        },
      ],
    });
  }

  if (and.length === 0) {
    return marketingDocumentWhere();
  }

  return marketingDocumentWhere({ AND: and });
}

const marketingDocumentListInclude = {
  batch: {
    select: {
      id: true,
      batchNo: true,
      releasedAt: true,
      product: {
        select: {
          name: true,
        },
      },
    },
  },
} satisfies Prisma.BatchDocumentInclude;

export type MarketingDocumentListRow = Prisma.BatchDocumentGetPayload<{
  include: typeof marketingDocumentListInclude;
}>;

const issuedCoaInclude = {
  coaResults: { orderBy: { sortOrder: "asc" as const } },
  batch: {
    include: {
      product: true,
    },
  },
  createdBy: { select: { id: true, fullName: true } },
  qcApprovedBy: { select: { id: true, fullName: true } },
  qaSignedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.BatchDocumentInclude;

export type MarketingIssuedCoaRow = Prisma.BatchDocumentGetPayload<{
  include: typeof issuedCoaInclude;
}>;

const releasedBatchInclude = {
  product: true,
  batchDocuments: {
    where: marketingDocumentWhere(),
    orderBy: { docType: "asc" as const },
    select: {
      id: true,
      docNo: true,
      docType: true,
      status: true,
      complianceVerdict: true,
      batchId: true,
    },
  },
} satisfies Prisma.BatchInclude;

export type MarketingReleasedBatchRow = Prisma.BatchGetPayload<{
  include: typeof releasedBatchInclude;
}>;

export async function findReleasedDocumentsForMarketing(
  filters: MarketingDocumentFilters,
  pagination: MarketingPagination,
  client: Db = prisma,
): Promise<{ items: MarketingDocumentListRow[]; total: number }> {
  const where = buildMarketingDocumentFilters(filters);

  const [items, total] = await Promise.all([
    client.batchDocument.findMany({
      where,
      include: marketingDocumentListInclude,
      orderBy: [{ batch: { releasedAt: "desc" } }, { docNo: "asc" }],
      skip: pagination.skip,
      take: pagination.take,
    }),
    client.batchDocument.count({ where }),
  ]);

  return { items, total };
}

export async function findIssuedCoaById(
  coaId: string,
  client: Db = prisma,
): Promise<MarketingIssuedCoaRow | null> {
  return client.batchDocument.findFirst({
    where: marketingDocumentWhere({ id: coaId, docType: DocType.COA }),
    include: issuedCoaInclude,
  });
}

export async function findReleasedBatchById(
  batchId: string,
  client: Db = prisma,
): Promise<MarketingReleasedBatchRow | null> {
  return client.batch.findFirst({
    where: { id: batchId, status: BatchStatus.RELEASED },
    include: releasedBatchInclude,
  });
}
