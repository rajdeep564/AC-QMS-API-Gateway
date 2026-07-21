import { DocType, FileType, RenderStatus } from "@prisma/client";
import { config } from "../config/env";
import { AppError } from "../lib/app-error";
import { createModuleLogger } from "../lib/logger";
import { prisma } from "../lib/prisma-types";
import type { Db } from "../lib/prisma-types";
import * as batchesRepo from "../modules/batches/batches.repository";
import * as specsRepo from "../modules/specs/specs.repository";
import { AuditAction, AuditEntityType, log as auditLog } from "./audit.service";
import { persistRenderedDocument } from "./persist-rendered-document";
import * as sopClient from "./sop-client";
import {
  mapAwsToRenderInput,
  mapCoaToRenderInput,
  mapToMoaRenderInput,
  mapToSpecRenderInput,
} from "./sop-mapper";

const log = createModuleLogger("render-documents");

const GENERATED_BY = "python-sop-service";

/** Serialize renders per entity — prevents concurrent write races on attachments. */
const renderQueues = new Map<string, Promise<unknown>>();

function renderLockKey(job: ScheduleRenderInput): string {
  return job.kind === "STANDING_SPEC"
    ? `spec:${job.specId}`
    : `bd:${job.batchDocumentId}`;
}

async function withRenderLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = renderQueues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  renderQueues.set(key, next);
  try {
    return await next;
  } finally {
    if (renderQueues.get(key) === next) {
      renderQueues.delete(key);
    }
  }
}

/**
 * Await all in-flight post-commit renders (test harness / graceful cleanup).
 * Loops briefly so a just-scheduled fire-and-forget job can enter the queue.
 * Safe no-op when the queue stays empty.
 */
export async function drainDocumentRenderQueues(timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  // Allow a tick for scheduleDocumentRender's void IIFE to call withRenderLock.
  await new Promise((r) => setTimeout(r, 50));
  while (renderQueues.size > 0) {
    await Promise.allSettled([...renderQueues.values()]);
    if (Date.now() - start > timeoutMs) {
      log.warn(
        { remaining: [...renderQueues.keys()] },
        "drainDocumentRenderQueues timed out with pending jobs",
      );
      return;
    }
    if (renderQueues.size > 0) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

export type RenderJobKind = "STANDING_SPEC" | "AWS" | "COA";

export type ScheduleRenderInput =
  | { kind: "STANDING_SPEC"; specId: string; actorId?: string }
  | { kind: "AWS"; batchDocumentId: string; actorId?: string }
  | { kind: "COA"; batchDocumentId: string; actorId?: string };

export type RenderDocumentsResult =
  | { status: "rendered"; files: number }
  | { status: "render_failed"; message: string }
  | { status: "skipped"; message: string };

type SaveDocxAndPdfResult = {
  files: number;
  persistFailed: boolean;
  /** True when the FK target was deleted mid-render (fixture cleanup race). */
  targetGone: boolean;
};

/**
 * Persist DOCX (+ optional PDF). Append-only — never deletes prior rows/files.
 * Persistence failures are non-blocking; call sites distinguish targetGone vs genuine fail.
 */
async function saveDocxAndPdf(input: {
  docx: Buffer;
  productCode: string;
  batchNo: string;
  docTypeLabel: string;
  docNo: string;
  filenameStem: string;
  specId?: string | null;
  batchDocumentId?: string | null;
}): Promise<SaveDocxAndPdfResult> {
  const docxResult = await persistRenderedDocument({
    bytes: input.docx,
    productCode: input.productCode,
    batchNo: input.batchNo,
    docTypeLabel: input.docTypeLabel,
    docNo: input.docNo,
    fileType: FileType.DOCX,
    specId: input.specId,
    batchDocumentId: input.batchDocumentId,
    generatedBy: GENERATED_BY,
  });

  if (docxResult.status === "target_gone") {
    return { files: 0, persistFailed: true, targetGone: true };
  }
  if (docxResult.status !== "ok") {
    return { files: 0, persistFailed: true, targetGone: false };
  }

  let files = 1;
  let targetGone = false;

  try {
    const pdf = await sopClient.convertPdf(input.docx, `${input.filenameStem}.docx`);
    const pdfResult = await persistRenderedDocument({
      bytes: pdf,
      productCode: input.productCode,
      batchNo: input.batchNo,
      docTypeLabel: input.docTypeLabel,
      docNo: input.docNo,
      fileType: FileType.PDF,
      specId: input.specId,
      batchDocumentId: input.batchDocumentId,
      generatedBy: GENERATED_BY,
    });
    if (pdfResult.status === "ok") {
      files += 1;
    } else if (pdfResult.status === "target_gone") {
      targetGone = true;
    } else if (!config.docModulePdfOptional) {
      return { files, persistFailed: true, targetGone: false };
    } else {
      log.warn(
        { docNo: input.docNo },
        "PDF persistence failed (DOC_MODULE_PDF_OPTIONAL); DOCX stored",
      );
    }
  } catch (err) {
    if (config.docModulePdfOptional) {
      log.warn(
        { err, docNo: input.docNo },
        "PDF conversion skipped (DOC_MODULE_PDF_OPTIONAL); DOCX stored",
      );
    } else {
      throw err;
    }
  }

  return { files, persistFailed: false, targetGone };
}

/** Log persistence outcome: warn for deleted targets, ERROR for genuine failures. */
async function handlePersistOutcome(input: {
  saved: SaveDocxAndPdfResult;
  specId?: string;
  batchDocumentId?: string;
  docNo?: string;
}): Promise<"ok" | "target_gone" | "failed"> {
  const { saved, specId, batchDocumentId, docNo } = input;

  if (saved.targetGone && saved.files === 0) {
    log.warn(
      { specId, batchDocumentId, docNo, files: saved.files },
      "target deleted, skipping",
    );
    return "target_gone";
  }

  if (saved.targetGone && saved.files > 0) {
    log.warn(
      { specId, batchDocumentId, docNo, files: saved.files },
      "target deleted mid-persist; partial files may exist",
    );
    // DOCX may have landed before delete — treat as soft success for status marking
    return "ok";
  }

  if (!saved.persistFailed && saved.files > 0) {
    return "ok";
  }

  // Genuine persist failure — confirm target still exists (else race without targetGone flag)
  if (batchDocumentId) {
    const exists = await prisma.batchDocument.findUnique({
      where: { id: batchDocumentId },
      select: { id: true },
    });
    if (!exists) {
      log.warn(
        { batchDocumentId, docNo, files: saved.files },
        "target deleted, skipping",
      );
      return "target_gone";
    }
  }
  if (specId) {
    const exists = await prisma.spec.findUnique({
      where: { id: specId },
      select: { id: true },
    });
    if (!exists) {
      log.warn({ specId, files: saved.files }, "target deleted, skipping");
      return "target_gone";
    }
  }

  const message = "Document render succeeded but persistence failed";
  if (specId) {
    await markSpecRender(specId, RenderStatus.FAILED, message);
    log.error({ specId, files: saved.files }, message);
  } else if (batchDocumentId) {
    await markBatchDocRender(batchDocumentId, RenderStatus.FAILED, message);
    log.error(
      { batchDocumentId, docNo, byteLength: undefined, files: saved.files },
      message,
    );
  }
  return "failed";
}

async function markSpecRender(specId: string, status: RenderStatus, error?: string) {
  try {
    await prisma.spec.update({
      where: { id: specId },
      data: {
        renderStatus: status,
        renderError: status === RenderStatus.FAILED ? (error ?? "render failed").slice(0, 2000) : null,
      },
    });
  } catch (err) {
    log.warn({ err, specId, status }, "markSpecRender skipped (entity may have been deleted)");
  }
}

async function markBatchDocRender(docId: string, status: RenderStatus, error?: string) {
  try {
    await prisma.batchDocument.update({
      where: { id: docId },
      data: {
        renderStatus: status,
        renderError: status === RenderStatus.FAILED ? (error ?? "render failed").slice(0, 2000) : null,
      },
    });
  } catch (err) {
    log.warn({ err, docId, status }, "markBatchDocRender skipped (entity may have been deleted)");
  }
}

type StandingLegOutcome = {
  leg: "SPEC" | "MOA";
  files: number;
  byteLength?: number;
  status: "ok" | "render_failed" | "persist_failed" | "target_gone";
  message?: string;
};

/** Independent generate+persist leg for standing SPEC fan-out (B-2.4). */
async function renderStandingLeg(input: {
  leg: "SPEC" | "MOA";
  specId: string;
  productCode: string;
  docNo: string;
  docTypeLabel: "SPEC" | "MOA";
  filenameStem: string;
  generate: () => Promise<Buffer>;
}): Promise<StandingLegOutcome> {
  try {
    const docx = await input.generate();
    const byteLength = docx.length;
    const saved = await saveDocxAndPdf({
      docx,
      productCode: input.productCode,
      batchNo: "_",
      docTypeLabel: input.docTypeLabel,
      docNo: input.docNo,
      filenameStem: input.filenameStem,
      specId: input.specId,
    });
    const outcome = await handlePersistOutcome({
      saved,
      specId: input.specId,
      docNo: input.docNo,
    });

    if (outcome === "target_gone") {
      log.warn(
        { specId: input.specId, leg: input.leg, docNo: input.docNo },
        "target deleted, skipping",
      );
      return { leg: input.leg, files: saved.files, byteLength, status: "target_gone" };
    }

    if (outcome === "failed") {
      log.error(
        { specId: input.specId, leg: input.leg, docNo: input.docNo, files: saved.files },
        `Standing ${input.leg} persist failed`,
      );
      return { leg: input.leg, files: saved.files, byteLength, status: "persist_failed" };
    }

    log.info(
      { specId: input.specId, leg: input.leg, files: saved.files, byteLength },
      `Standing ${input.leg} rendered`,
    );
    return { leg: input.leg, files: saved.files, byteLength, status: "ok" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { err, specId: input.specId, leg: input.leg, docNo: input.docNo },
      `Standing ${input.leg} render failed (non-blocking)`,
    );
    return { leg: input.leg, files: 0, status: "render_failed", message };
  }
}

function isGenuineStandingFailure(status: StandingLegOutcome["status"]): boolean {
  return status === "render_failed" || status === "persist_failed";
}

async function renderStandingSpec(specId: string, actorId?: string): Promise<RenderDocumentsResult> {
  const spec = await specsRepo.findSpecWithMoaForRender(specId);
  if (!spec) throw AppError.notFound("SPEC");
  if (!spec.moaDoc) throw AppError.conflict("MOA is required before standing render");

  const specReq = await mapToSpecRenderInput(specId);
  const moaReq = await mapToMoaRenderInput(specId);
  const productCode = specReq.product.product_code;
  if (!productCode) throw AppError.conflict("product_code required for standing render storage");

  // Append-only: do not delete prior attachments on re-render.
  // Each leg is independent — sibling failure must not taint the other (B-2.4).
  const specOutcome = await renderStandingLeg({
    leg: "SPEC",
    specId,
    productCode,
    docNo: spec.specNo,
    docTypeLabel: "SPEC",
    filenameStem: "spec",
    generate: () => sopClient.generate(specReq),
  });

  const moaOutcome = await renderStandingLeg({
    leg: "MOA",
    specId,
    productCode,
    docNo: spec.moaDoc.moaNo,
    docTypeLabel: "MOA",
    filenameStem: "moa",
    generate: () => sopClient.generate(moaReq),
  });

  const files = specOutcome.files + moaOutcome.files;
  const bothTargetGone =
    specOutcome.status === "target_gone" && moaOutcome.status === "target_gone";
  const bothGenuineFailed =
    isGenuineStandingFailure(specOutcome.status) &&
    isGenuineStandingFailure(moaOutcome.status) &&
    files === 0;

  if (bothTargetGone) {
    return { status: "skipped", message: "target deleted, skipping" };
  }

  if (bothGenuineFailed) {
    const message = [specOutcome.message, moaOutcome.message].filter(Boolean).join("; ");
    await markSpecRender(specId, RenderStatus.FAILED, message || "both SPEC and MOA render failed");
    await auditLog({
      userId: actorId,
      action: AuditAction.RENDER_FAILED,
      entityType: AuditEntityType.SPEC,
      entityId: specId,
      docNo: spec.specNo,
      comment: (message || "Standing SPEC+MOA render failed").slice(0, 500),
    });
    return { status: "render_failed", message: message || "both legs failed" };
  }

  if (files > 0) {
    await markSpecRender(specId, RenderStatus.RENDERED);
    await auditLog({
      userId: actorId,
      action: AuditAction.GENERATE,
      entityType: AuditEntityType.SPEC,
      entityId: specId,
      docNo: spec.specNo,
      comment: `Standing SPEC+MOA rendered (${files} files; SPEC=${specOutcome.status}, MOA=${moaOutcome.status})`,
    });
    return { status: "rendered", files };
  }

  // Partial target_gone with zero files — treat as skipped
  if (specOutcome.status === "target_gone" || moaOutcome.status === "target_gone") {
    return { status: "skipped", message: "target deleted, skipping" };
  }

  return { status: "rendered", files: 0 };
}

async function renderAws(batchDocumentId: string, actorId?: string): Promise<RenderDocumentsResult> {
  const payload = await mapAwsToRenderInput(batchDocumentId);
  const doc = await batchesRepo.findAwsDocumentForRender(batchDocumentId);
  if (!doc) throw AppError.notFound("AWS document");

  const productCode = payload.product.product_code;
  if (!productCode) throw AppError.conflict("product_code required for AWS render storage");

  // Append-only: do not delete prior attachments on re-render.

  const docx = await sopClient.render("aws", payload);
  const saved = await saveDocxAndPdf({
    docx,
    productCode,
    batchNo: doc.batch.batchNo,
    docTypeLabel: "AWS",
    docNo: doc.docNo,
    filenameStem: "aws",
    batchDocumentId,
  });

  if (saved.persistFailed || saved.files === 0 || saved.targetGone) {
    const outcome = await handlePersistOutcome({
      saved,
      batchDocumentId,
      docNo: doc.docNo,
    });
    if (outcome === "target_gone") {
      return { status: "skipped", message: "target deleted, skipping" };
    }
    if (outcome === "failed") {
      return { status: "rendered", files: saved.files };
    }
  }

  await markBatchDocRender(batchDocumentId, RenderStatus.RENDERED);
  await auditLog({
    userId: actorId,
    action: AuditAction.GENERATE,
    entityType: AuditEntityType.AWS,
    entityId: batchDocumentId,
    docNo: doc.docNo,
    comment: `AWS rendered (${saved.files} files)`,
  });

  return { status: "rendered", files: saved.files };
}

async function renderCoa(batchDocumentId: string, actorId?: string): Promise<RenderDocumentsResult> {
  const payload = await mapCoaToRenderInput(batchDocumentId);
  const doc = await batchesRepo.findCoaDocumentForRender(batchDocumentId);
  if (!doc) throw AppError.notFound("COA document");

  const productCode = payload.product.product_code;
  if (!productCode) throw AppError.conflict("product_code required for COA render storage");

  // Append-only: do not delete prior attachments on re-render.

  const docx = await sopClient.render("coa", payload);
  const saved = await saveDocxAndPdf({
    docx,
    productCode,
    batchNo: doc.batch.batchNo,
    docTypeLabel: "COA",
    docNo: doc.docNo,
    filenameStem: "coa",
    batchDocumentId,
  });

  if (saved.persistFailed || saved.files === 0 || saved.targetGone) {
    const outcome = await handlePersistOutcome({
      saved,
      batchDocumentId,
      docNo: doc.docNo,
    });
    if (outcome === "target_gone") {
      return { status: "skipped", message: "target deleted, skipping" };
    }
    if (outcome === "failed") {
      // Transition already committed — return rendered (files may be 0)
      return { status: "rendered", files: saved.files };
    }
  }

  await markBatchDocRender(batchDocumentId, RenderStatus.RENDERED);
  await auditLog({
    userId: actorId,
    action: AuditAction.GENERATE,
    entityType: AuditEntityType.COA,
    entityId: batchDocumentId,
    docNo: doc.docNo,
    comment: `COA rendered (${saved.files} files)`,
  });

  return { status: "rendered", files: saved.files };
}

async function failRender(
  job: ScheduleRenderInput,
  err: unknown,
): Promise<RenderDocumentsResult> {
  const message = err instanceof Error ? err.message : String(err);
  log.error({ err, job }, "Document render failed (non-blocking)");

  if (job.kind === "STANDING_SPEC") {
    await markSpecRender(job.specId, RenderStatus.FAILED, message);
    await auditLog({
      userId: job.actorId,
      action: AuditAction.RENDER_FAILED,
      entityType: AuditEntityType.SPEC,
      entityId: job.specId,
      comment: message.slice(0, 500),
    });
  } else {
    await markBatchDocRender(job.batchDocumentId, RenderStatus.FAILED, message);
    await auditLog({
      userId: job.actorId,
      action: AuditAction.RENDER_FAILED,
      entityType: job.kind === "COA" ? AuditEntityType.COA : AuditEntityType.AWS,
      entityId: job.batchDocumentId,
      comment: message.slice(0, 500),
    });
  }

  return { status: "render_failed", message };
}

/**
 * Post-commit render dispatcher.
 * Awaits PENDING mark + GENERATE "scheduled" audit, then runs render without blocking the caller
 * on the Python call (fire-and-forget). Callers should `await scheduleDocumentRender(...)`
 * so workflow verifiers observe the GENERATE audit immediately.
 */
export async function scheduleDocumentRender(job: ScheduleRenderInput): Promise<void> {
  const entityId = job.kind === "STANDING_SPEC" ? job.specId : job.batchDocumentId;
  const entityType =
    job.kind === "STANDING_SPEC"
      ? AuditEntityType.SPEC
      : job.kind === "COA"
        ? AuditEntityType.COA
        : AuditEntityType.AWS;

  if (job.kind === "STANDING_SPEC") {
    await markSpecRender(job.specId, RenderStatus.PENDING);
  } else {
    await markBatchDocRender(job.batchDocumentId, RenderStatus.PENDING);
  }

  await auditLog({
    userId: job.actorId,
    action: AuditAction.GENERATE,
    entityType,
    entityId,
    comment: `Epic 21 document render scheduled (${job.kind})`,
  });

  void (async () => {
    try {
      await executeDocumentRender(job);
    } catch (err) {
      try {
        await failRender(job, err);
      } catch (failErr) {
        log.error({ err: failErr, job }, "failRender itself failed (swallowed)");
      }
    }
  })();
}

export async function executeDocumentRender(
  job: ScheduleRenderInput,
): Promise<RenderDocumentsResult> {
  return withRenderLock(renderLockKey(job), async () => {
    try {
      if (job.kind === "STANDING_SPEC") {
        return await renderStandingSpec(job.specId, job.actorId);
      }
      if (job.kind === "AWS") {
        return await renderAws(job.batchDocumentId, job.actorId);
      }
      return await renderCoa(job.batchDocumentId, job.actorId);
    } catch (err) {
      return failRender(job, err);
    }
  });
}

/**
 * Retry FAILED or PENDING renders. Throws AppError on invalid state.
 */
export async function retryDocumentRender(
  job: ScheduleRenderInput,
): Promise<RenderDocumentsResult> {
  if (job.kind === "STANDING_SPEC") {
    const spec = await prisma.spec.findUnique({
      where: { id: job.specId },
      select: { renderStatus: true },
    });
    if (!spec) throw AppError.notFound("SPEC");
    if (
      spec.renderStatus !== RenderStatus.FAILED &&
      spec.renderStatus !== RenderStatus.PENDING
    ) {
      throw AppError.conflict(`Render status is ${spec.renderStatus}; retry only for FAILED|PENDING`);
    }
  } else {
    const doc = await prisma.batchDocument.findUnique({
      where: { id: job.batchDocumentId },
      select: { renderStatus: true, docType: true },
    });
    if (!doc) throw AppError.notFound("Document");
    if (
      doc.renderStatus !== RenderStatus.FAILED &&
      doc.renderStatus !== RenderStatus.PENDING
    ) {
      throw AppError.conflict(`Render status is ${doc.renderStatus}; retry only for FAILED|PENDING`);
    }
    if (job.kind === "AWS" && doc.docType !== DocType.AWS) {
      throw AppError.validation("Document is not an AWS");
    }
    if (job.kind === "COA" && doc.docType !== DocType.COA) {
      throw AppError.validation("Document is not a COA");
    }
  }

  return executeDocumentRender(job);
}

/**
 * @deprecated Prefer scheduleDocumentRender / executeDocumentRender.
 * Kept for transitional callers that previously awaited the 501 stub.
 */
export async function renderDocuments(
  docType: RenderJobKind,
  entityId: string,
  meta?: { userId?: string },
  _client?: Db,
): Promise<RenderDocumentsResult> {
  const job: ScheduleRenderInput =
    docType === "STANDING_SPEC"
      ? { kind: "STANDING_SPEC", specId: entityId, actorId: meta?.userId }
      : docType === "AWS"
        ? { kind: "AWS", batchDocumentId: entityId, actorId: meta?.userId }
        : { kind: "COA", batchDocumentId: entityId, actorId: meta?.userId };

  return executeDocumentRender(job);
}
