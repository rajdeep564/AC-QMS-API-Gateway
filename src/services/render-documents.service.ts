import { createModuleLogger } from "../lib/logger";
import type { Db } from "../lib/prisma-types";
import { mapToCoaRenderInput } from "./coa-render-mapper";
import { AuditAction, AuditEntityType, log as auditLog } from "./audit.service";
import { postRender } from "./sop-client";

const log = createModuleLogger("render-documents");

export type RenderDocType = "STANDING_SPEC" | "AWS" | "COA";

export type RenderDocumentsResult =
  | { status: "queued"; message: string }
  | { status: "rendered"; byteLength: number }
  | { status: "render_failed"; message: string };

async function executeCoaRender(
  entityId: string,
  meta?: { userId?: string; docNo?: string },
): Promise<RenderDocumentsResult> {
  const payload = await mapToCoaRenderInput(entityId);
  const result = await postRender("coa", payload);

  if (result.ok) {
    log.info(
      {
        coaDocId: entityId,
        docNo: meta?.docNo,
        status: result.status,
        contentType: result.contentType,
        byteLength: result.byteLength,
      },
      "COA render succeeded",
    );
    return { status: "rendered", byteLength: result.byteLength };
  }

  log.error(
    {
      coaDocId: entityId,
      docNo: meta?.docNo,
      kind: result.kind,
      httpStatus: result.status,
      reason: result.message,
    },
    "COA render failed — recoverable; COA remains ISSUED and batch RELEASED",
  );
  return { status: "render_failed", message: result.message };
}

/** Epic 21 — Python DOCX/PDF render seam. COA calls DOC-Module after commit; AWS/STANDING remain stubs. */
export async function renderDocuments(
  docType: RenderDocType,
  entityId: string,
  meta?: { userId?: string; docNo?: string },
  client?: Db,
): Promise<RenderDocumentsResult> {
  if (docType === "COA") {
    return executeCoaRender(entityId, meta);
  }

  log.info({ docType, entityId }, "TODO Epic 21: queue document render via Python microservice");

  const auditEntityType =
    docType === "STANDING_SPEC" ? AuditEntityType.SPEC : AuditEntityType.AWS;

  await auditLog(
    {
      userId: meta?.userId,
      action: AuditAction.GENERATE,
      entityType: auditEntityType,
      entityId,
      docNo: meta?.docNo,
      comment: `${docType} render queued — Epic 21 Python integration pending`,
    },
    client,
  );

  return {
    status: "queued",
    message: `${docType} render queued (Epic 21 — Python integration pending)`,
  };
}
