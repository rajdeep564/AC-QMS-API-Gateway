import { DocPhase, DocStatus, SectionStatus } from "@prisma/client";
import type { Tx } from "../lib/prisma-types";
import { AppError } from "../lib/app-error";
import * as batchesRepo from "../modules/batches/batches.repository";
import { authoringTransition } from "./workflow-engine";
import { AuditAction, AuditEntityType, log as auditLog } from "./audit.service";
import { batchLink } from "./notification-links";
import { notify } from "./notification.service";

export async function autoCreateAwsSkeletonFromSignedMoa(
  tx: Tx,
  batchId: string,
  signedMoaDocId: string,
  moaDocNo: string,
): Promise<void> {
  const awsDoc = await batchesRepo.findPendingAwsDocument(batchId, tx);

  if (!awsDoc) {
    throw AppError.conflict("PENDING AWS document not found for batch");
  }

  const specDoc = await batchesRepo.findSpecDocumentByBatchId(batchId, tx);

  if (!specDoc) {
    throw AppError.conflict("SPEC document not found for batch");
  }

  if (specDoc.status !== DocStatus.QA_SIGNED) {
    throw AppError.conflict("SPEC document must be QA signed before AWS skeleton creation");
  }

  const specTests = specDoc.specDocumentTests;

  await batchesRepo.deleteAwsSections(awsDoc.id, tx);

  if (specTests.length > 0) {
    await batchesRepo.createAwsSections(
      specTests.map((specTest) => ({
        batchDocumentId: awsDoc.id,
        testParameterId: specTest.testParameterId,
        specDocumentTestId: specTest.id,
        sortOrder: specTest.sortOrder,
        status: SectionStatus.NOT_STARTED,
      })),
      tx,
    );
  }

  await authoringTransition({
    entityType: "AWS_DOCUMENT",
    entityId: awsDoc.id,
    tx,
    systemTriggered: true,
  });

  await batchesRepo.updateBatchPhase(batchId, DocPhase.AWS, tx);

  const batch = await batchesRepo.findBatchByIdForNotification(batchId, tx);

  await auditLog({
    userName: "System",
    action: AuditAction.GENERATE,
    entityType: AuditEntityType.AWS,
    entityId: awsDoc.id,
    docNo: awsDoc.docNo,
    comment: `auto-created from signed MOA ${moaDocNo}; ${specTests.length} sections seeded`,
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
