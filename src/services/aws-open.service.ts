import { DocStatus, SectionStatus } from "@prisma/client";
import type { Tx } from "../lib/prisma-types";
import { AppError } from "../lib/app-error";
import * as batchesRepo from "../modules/batches/batches.repository";
import { AuditAction, AuditEntityType, log as auditLog } from "./audit.service";
import { batchLink } from "./notification-links";
import { notify } from "./notification.service";

/** US-9-13 / Epic 12: activate AWS batch_document and populate sections from batch snapshot. */
export async function openAwsForBatch(tx: Tx, batchId: string): Promise<void> {
  const awsDoc = await batchesRepo.findBatchDocumentByType(batchId, "AWS", tx);
  if (!awsDoc) {
    throw AppError.conflict("AWS batch document not found");
  }
  if (awsDoc.status !== DocStatus.PENDING) {
    throw AppError.conflict("AWS document is not in PENDING status");
  }

  const existingSections = await tx.awsSection.count({
    where: { batchDocumentId: awsDoc.id },
  });
  if (existingSections > 0) {
    throw AppError.conflict("AWS sections already populated for this document");
  }

  const snapshotTests = await batchesRepo.findSpecDocumentTestsByBatchId(batchId, tx);
  if (snapshotTests.length > 0) {
    await batchesRepo.createAwsSections(
      snapshotTests.map((test) => ({
        batchDocumentId: awsDoc.id,
        specDocumentTestId: test.id,
        status: SectionStatus.NOT_STARTED,
      })),
      tx,
    );
  }

  await batchesRepo.updateBatchDocumentStatus(awsDoc.id, DocStatus.DRAFT, tx);

  const batch = await batchesRepo.findBatchById(batchId, tx);

  await auditLog(
    {
      userName: "System",
      action: AuditAction.GENERATE,
      entityType: AuditEntityType.AWS,
      entityId: awsDoc.id,
      docNo: awsDoc.docNo,
      comment: `AWS activated (PENDING→DRAFT) with ${snapshotTests.length} sections from batch snapshot`,
    },
    tx,
  );

  if (batch?.assignedQcExecId && batch.batchNo) {
    await notify({
      recipients: { users: [batch.assignedQcExecId] },
      type: "AWS_CREATED",
      title: "AWS protocol ready",
      message: `AWS protocol ready for batch ${batch.batchNo}.`,
      link: batchLink(batchId),
      tx,
    });
  }
}
