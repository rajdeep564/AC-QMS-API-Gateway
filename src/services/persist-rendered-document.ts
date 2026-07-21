import { FileType, Prisma } from "@prisma/client";
import { createModuleLogger } from "../lib/logger";
import { prisma } from "../lib/prisma-types";
import * as fileAttachmentsRepo from "../modules/documents/file-attachments.repository";
import {
  buildRenderedStorageKey,
  contentTypeForFileType,
  getDocumentStorage,
} from "./storage";

const log = createModuleLogger("persist-rendered-document");

export type PersistRenderedDocumentInput = {
  bytes: Buffer;
  productCode: string;
  batchNo: string;
  /** COA | AWS | SPEC | MOA — path label only; schema has no docType column. */
  docTypeLabel: string;
  docNo: string;
  fileType: FileType;
  batchDocumentId?: string | null;
  specId?: string | null;
  generatedBy?: string;
};

export type PersistRenderedDocumentOk = {
  status: "ok";
  attachmentId: string;
  storageKey: string;
  byteLength: number;
};

export type PersistRenderedDocumentOutcome =
  | PersistRenderedDocumentOk
  | { status: "target_gone" }
  | { status: "failed" };

/** @deprecated Prefer PersistRenderedDocumentOutcome — kept for callers that check null. */
export type PersistRenderedDocumentResult = {
  attachmentId: string;
  storageKey: string;
  byteLength: number;
};

function isTargetGoneError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2003" || err.code === "P2025")
  );
}

/**
 * Doc-type-agnostic persist: storage adapter + file_attachments row.
 * Never throws — returns outcome so COA/batch transitions stay committed.
 * target_gone → warn only (fixture cleanup race). failed → genuine persist error.
 */
export async function persistRenderedDocument(
  input: PersistRenderedDocumentInput,
): Promise<PersistRenderedDocumentOutcome> {
  const generatedBy = input.generatedBy ?? "python-sop-service";
  const storageKey = buildRenderedStorageKey({
    productCode: input.productCode,
    batchNo: input.batchNo,
    docTypeLabel: input.docTypeLabel,
    docNo: input.docNo,
    fileType: input.fileType,
  });

  const context = {
    batchDocumentId: input.batchDocumentId,
    specId: input.specId,
    docNo: input.docNo,
    docTypeLabel: input.docTypeLabel,
    fileType: input.fileType,
    byteLength: input.bytes.length,
    storageKey,
  };

  try {
    if (input.batchDocumentId) {
      const exists = await prisma.batchDocument.findUnique({
        where: { id: input.batchDocumentId },
        select: { id: true },
      });
      if (!exists) {
        log.warn(
          context,
          "skipping persistence — target batch_document no longer exists",
        );
        return { status: "target_gone" };
      }
    }

    if (input.specId) {
      const exists = await prisma.spec.findUnique({
        where: { id: input.specId },
        select: { id: true },
      });
      if (!exists) {
        log.warn(context, "skipping persistence — target spec no longer exists");
        return { status: "target_gone" };
      }
    }

    const storage = getDocumentStorage();
    const saved = await storage.save(
      storageKey,
      input.bytes,
      contentTypeForFileType(input.fileType),
    );

    const row = await fileAttachmentsRepo.createFileAttachment({
      batchDocumentId: input.batchDocumentId,
      specId: input.specId,
      fileType: input.fileType,
      filePath: saved.storageKey,
      generatedBy,
    });

    return {
      status: "ok",
      attachmentId: row.id,
      storageKey: saved.storageKey,
      byteLength: saved.byteLength,
    };
  } catch (err) {
    if (isTargetGoneError(err)) {
      log.warn(
        { ...context, err },
        "skipping persistence — target deleted (FK/not-found race)",
      );
      return { status: "target_gone" };
    }

    log.error(
      { ...context, err },
      "Document persistence failed (non-blocking)",
    );
    return { status: "failed" };
  }
}
