import { FileType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma-types";
import type { Db } from "../../lib/prisma-types";

export async function createFileAttachment(
  data: {
    batchDocumentId?: string | null;
    specId?: string | null;
    fileType: FileType;
    filePath: string;
    generatedBy?: string | null;
  },
  client: Db = prisma,
) {
  return client.fileAttachment.create({
    data: {
      batchDocumentId: data.batchDocumentId ?? null,
      specId: data.specId ?? null,
      fileType: data.fileType,
      filePath: data.filePath,
      generatedBy: data.generatedBy ?? null,
    },
  });
}

export async function listByBatchId(batchId: string, client: Db = prisma) {
  return client.fileAttachment.findMany({
    where: {
      OR: [
        { batchDocument: { batchId } },
        {
          specId: {
            in: (
              await client.batch.findUnique({
                where: { id: batchId },
                select: { sourceSpecId: true },
              })
            )?.sourceSpecId
              ? [
                  (
                    await client.batch.findUnique({
                      where: { id: batchId },
                      select: { sourceSpecId: true },
                    })
                  )!.sourceSpecId,
                ]
              : [],
          },
        },
      ],
    },
    include: {
      batchDocument: { select: { id: true, docType: true, docNo: true, status: true } },
      spec: { select: { id: true, specNo: true, status: true, moaDoc: { select: { moaNo: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Leaner list for GET /batches/:id/documents — one batch lookup then attachments. */
export async function listAttachmentsForBatch(batchId: string, client: Db = prisma) {
  const batch = await client.batch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      status: true,
      sourceSpecId: true,
      batchDocuments: {
        select: {
          id: true,
          docType: true,
          docNo: true,
          status: true,
          attachments: {
            orderBy: { createdAt: "asc" as const },
          },
        },
      },
    },
  });
  if (!batch) return null;

  const standing =
    batch.sourceSpecId != null
      ? await client.fileAttachment.findMany({
          where: { specId: batch.sourceSpecId },
          include: {
            spec: {
              select: {
                id: true,
                specNo: true,
                status: true,
                moaDoc: { select: { moaNo: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        })
      : [];

  return { batch, standingAttachments: standing };
}

export async function findByIdWithAccessContext(id: string, client: Db = prisma) {
  return client.fileAttachment.findUnique({
    where: { id },
    include: {
      batchDocument: {
        include: {
          batch: {
            select: {
              id: true,
              status: true,
              productId: true,
              assignedQcExecId: true,
            },
          },
        },
      },
      spec: {
        select: {
          id: true,
          productId: true,
          status: true,
          specNo: true,
          moaDoc: { select: { id: true, moaNo: true } },
        },
      },
    },
  });
}

export async function listAttachmentsForSpec(specId: string, client: Db = prisma) {
  const spec = await client.spec.findUnique({
    where: { id: specId },
    select: {
      id: true,
      specNo: true,
      status: true,
      moaDoc: { select: { moaNo: true } },
    },
  });
  if (!spec) return null;

  const attachments = await client.fileAttachment.findMany({
    where: { specId },
    orderBy: { createdAt: "asc" },
  });

  return { spec, attachments };
}

export async function deleteAttachmentsForEntity(
  where: { specId: string } | { batchDocumentId: string },
  client: Db = prisma,
) {
  return client.fileAttachment.deleteMany({ where });
}

export type FileAttachmentCreateInput = Prisma.FileAttachmentCreateInput;
