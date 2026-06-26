import { DocPhase } from "@prisma/client";
import type { Tx } from "../lib/prisma-types";
import { AppError } from "../lib/app-error";
import * as batchesRepo from "../modules/batches/batches.repository";
import * as mastersRepo from "../modules/masters/masters.repository";
import { authoringTransition } from "./workflow-engine";
import { AuditAction, AuditEntityType, log as auditLog } from "./audit.service";
import { batchLink } from "./notification-links";
import { notify } from "./notification.service";

export async function autoCreateMoaFromSignedSpec(
  tx: Tx,
  batchId: string,
  signedSpecDocId: string,
  specDocNo: string,
): Promise<void> {
  const moaDoc = await batchesRepo.findPendingMoaDocument(batchId, tx);

  if (!moaDoc) {
    throw AppError.conflict("PENDING MOA document not found for batch");
  }

  const specTests = await batchesRepo.findSpecDocumentTests(signedSpecDocId, tx);

  const specDoc = await batchesRepo.findBatchDocumentSourceMaster(signedSpecDocId, tx);

  if (!specDoc?.sourceMasterId) {
    throw AppError.conflict("Signed SPEC document is missing source master reference");
  }

  const moaSections = await mastersRepo.findMoaSectionsByMasterId(specDoc.sourceMasterId, tx);
  const moaByTestParam = new Map(moaSections.map((s) => [s.testParameterId, s]));

  await batchesRepo.deleteMoaDocumentSections(moaDoc.id, tx);

  if (specTests.length > 0) {
    await batchesRepo.createMoaDocumentSections(
      specTests.map((test) => {
        const masterMoa = moaByTestParam.get(test.testParameterId);
        return {
          batchDocumentId: moaDoc.id,
          testParameterId: test.testParameterId,
          sortOrder: test.sortOrder,
          testName: test.testName,
          pharmacopoeia: masterMoa?.pharmacopoeia ?? null,
          samplePreparation: masterMoa?.samplePreparation ?? null,
          standardPreparation: masterMoa?.standardPreparation ?? null,
          blankPreparation: masterMoa?.blankPreparation ?? null,
          conclusionTemplate: masterMoa?.conclusionTemplate ?? null,
          additionalNotes: masterMoa?.additionalNotes ?? null,
        };
      }),
      tx,
    );
  }

  await authoringTransition({
    entityType: "MOA_DOCUMENT",
    entityId: moaDoc.id,
    tx,
    systemTriggered: true,
  });

  const batch = await batchesRepo.updateBatchPhase(batchId, DocPhase.MOA, tx);

  await auditLog({
    userName: "System",
    action: AuditAction.GENERATE,
    entityType: AuditEntityType.MOA,
    entityId: moaDoc.id,
    docNo: moaDoc.docNo,
    comment: `auto-created from signed SPEC ${specDocNo}`,
  });

  if (batch.assignedQcExecId) {
    await notify({
      recipients: { users: [batch.assignedQcExecId] },
      type: "MOA_CREATED",
      title: "MOA ready for review",
      message: `MOA ${moaDoc.docNo} created from signed SPEC ${specDocNo}.`,
      link: batchLink(batchId),
      tx,
    });
  }
}
