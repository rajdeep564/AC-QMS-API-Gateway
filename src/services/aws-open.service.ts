import { DocStatus, SectionStatus } from "@prisma/client";
import type { Tx } from "../lib/prisma-types";
import { AppError } from "../lib/app-error";
import * as batchesRepo from "../modules/batches/batches.repository";
import { AuditAction, AuditEntityType, log as auditLog } from "./audit.service";
import { batchLink } from "./notification-links";
import { notify } from "./notification.service";

/** Opens AWS for execution after batch QA approval (Rev 2.3). */
export async function openAwsForBatch(tx: Tx, batchId: string): Promise<void> {
  const awsDoc = await batchesRepo.findBatchDocumentByType(batchId, "AWS", tx);
  if (!awsDoc) {
    throw AppError.conflict("AWS batch document not found");
  }
  if (awsDoc.status !== DocStatus.PENDING) {
    throw AppError.conflict("AWS document is not in PENDING status");
  }

  const snapshotTests = await batchesRepo.findSpecDocumentTestsByBatchId(batchId, tx);
  await batchesRepo.deleteAwsSectionsForDocument(awsDoc.id, tx);

  if (snapshotTests.length > 0) {
    await batchesRepo.createAwsSections(
      snapshotTests.map((t) => ({
        batchDocumentId: awsDoc.id,
        specDocumentTestId: t.id,
        status: SectionStatus.NOT_STARTED,
      })),
      tx,
    );
  }

  await batchesRepo.updateBatchDocumentStatus(awsDoc.id, DocStatus.DRAFT, tx);

  const batch = await batchesRepo.findBatchById(batchId, tx);

  await auditLog({
    userName: "System",
    action: AuditAction.GENERATE,
    entityType: AuditEntityType.AWS,
    entityId: awsDoc.id,
    docNo: awsDoc.docNo,
    comment: `AWS opened with ${snapshotTests.length} sections from batch snapshot`,
  });

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
