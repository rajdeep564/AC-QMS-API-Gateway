import { createModuleLogger } from "../lib/logger";
import { AuditAction, AuditEntityType, log as auditLog } from "./audit.service";

const log = createModuleLogger("render-documents");

export type RenderDocType = "STANDING_SPEC" | "AWS" | "COA";

export type RenderDocumentsResult = {
  status: "queued";
  message: string;
};

/** Epic 21 — Python DOCX/PDF render seam. No HTTP call in Session 2/3. */
export async function renderDocuments(
  docType: RenderDocType,
  entityId: string,
  meta?: { userId?: string; docNo?: string },
): Promise<RenderDocumentsResult> {
  log.info({ docType, entityId }, "TODO Epic 21: queue document render via Python microservice");

  const auditEntityType =
    docType === "STANDING_SPEC"
      ? AuditEntityType.SPEC
      : docType === "AWS"
        ? AuditEntityType.AWS
        : AuditEntityType.COA;

  await auditLog({
    userId: meta?.userId,
    action: AuditAction.GENERATE,
    entityType: auditEntityType,
    entityId,
    docNo: meta?.docNo,
    comment: `${docType} render queued — Epic 21 Python integration pending`,
  });

  return {
    status: "queued",
    message: `${docType} render queued (Epic 21 — Python integration pending)`,
  };
}
