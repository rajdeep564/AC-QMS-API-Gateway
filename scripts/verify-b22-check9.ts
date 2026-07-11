/**
 * B-2.2 check #9 — render failure non-blocking with unreachable DOC-Module URL.
 * Runs in a fresh process so DOC_MODULE_URL env is picked up before config load.
 */
import "dotenv/config";
import { BatchStatus, DocStatus, Role } from "@prisma/client";
import { prisma } from "../src/lib/prisma-types";
import { signAndIssueCoa } from "../src/modules/documents/documents.service";
import { renderDocuments } from "../src/services/render-documents.service";
import { JwtAccessPayload } from "../src/types/auth.types";

const DEV_PASSWORD = "Acqms@2026";

function actor(userId: string, role: Role): JwtAccessPayload {
  return { userId, role, departmentId: null };
}

async function main() {
  const coaDocId = process.argv[2];
  const batchId = process.argv[3];
  const sanjayId = process.argv[4];
  if (!coaDocId || !batchId || !sanjayId) {
    throw new Error("Usage: verify-b22-check9.ts <coaDocId> <batchId> <sanjayId>");
  }

  await signAndIssueCoa(coaDocId, actor(sanjayId, Role.QA_MGR), DEV_PASSWORD);

  const coa = await prisma.batchDocument.findUniqueOrThrow({ where: { id: coaDocId } });
  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
  const renderResult = await renderDocuments("COA", coaDocId, { docNo: coa.docNo });

  console.log("COA status (renderer unreachable):", coa.status);
  console.log("Batch status (renderer unreachable):", batch.status);
  console.log("renderDocuments result:", JSON.stringify(renderResult, null, 2));

  if (coa.status !== DocStatus.ISSUED) throw new Error("COA must stay ISSUED");
  if (batch.status !== BatchStatus.RELEASED) throw new Error("Batch must stay RELEASED");
  if (renderResult.status !== "render_failed") throw new Error("Expected render_failed");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
