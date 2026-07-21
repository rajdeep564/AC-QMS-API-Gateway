/**
 * B-2.3 check #7 — AWS render failure non-blocking; COA still auto-generates.
 * Fresh process with unreachable DOC_MODULE_URL (env set by parent).
 */
import "dotenv/config";
import { DocStatus, Role } from "@prisma/client";
import { prisma } from "../src/lib/prisma-types";
import { transitionDocument } from "../src/modules/documents/documents.service";
import {
  drainDocumentRenderQueues,
  executeDocumentRender,
} from "../src/services/render-documents.service";
import { JwtAccessPayload } from "../src/types/auth.types";

const DEV_PASSWORD = process.env.VERIFY_SEED_PASSWORD ?? "Acqms@2026";

function actor(userId: string, role: Role): JwtAccessPayload {
  return { userId, role, departmentId: null };
}

async function main() {
  const awsDocId = process.argv[2];
  const batchId = process.argv[3];
  const sanjayId = process.argv[4];
  if (!awsDocId || !batchId || !sanjayId) {
    throw new Error("Usage: verify-b23-check7.ts <awsDocId> <batchId> <sanjayId>");
  }

  await transitionDocument(awsDocId, "SIGN", actor(sanjayId, Role.QA_MGR), DEV_PASSWORD);
  await drainDocumentRenderQueues(30_000);

  const aws = await prisma.batchDocument.findUniqueOrThrow({ where: { id: awsDocId } });
  const coa = await prisma.batchDocument.findFirstOrThrow({
    where: { batchId, docType: "COA" },
  });

  const renderResult = await executeDocumentRender({
    kind: "AWS",
    batchDocumentId: awsDocId,
    actorId: sanjayId,
  });

  console.log("AWS status (renderer unreachable):", aws.status);
  console.log("AWS renderStatus:", aws.renderStatus, "renderError:", aws.renderError);
  console.log("COA status after AWS sign:", coa.status);
  console.log("renderDocuments result:", JSON.stringify(renderResult, null, 2));

  if (aws.status !== DocStatus.QA_SIGNED) throw new Error("AWS must stay QA_SIGNED");
  if (coa.status !== DocStatus.AUTO_GENERATED) {
    throw new Error(`COA must stay AUTO_GENERATED, got ${coa.status}`);
  }
  if (renderResult.status !== "render_failed") {
    throw new Error(`Expected render_failed, got ${renderResult.status}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
