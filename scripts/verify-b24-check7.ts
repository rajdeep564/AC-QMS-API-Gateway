/**
 * B-2.4 check #7 — MOA generate fails; SPEC still persisted; QA_SIGNED held.
 * Fresh subprocess with STANDING_MOA_GENERATE_FAIL=1 (env set by parent).
 */
import "dotenv/config";
import { FileType, RenderStatus, Role, StandingDocStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma-types";
import {
  approveSpec,
  createSpec,
  signSpec,
  submitSpec,
} from "../src/modules/specs/specs.service";
import { drainDocumentRenderQueues } from "../src/services/render-documents.service";
import { JwtAccessPayload } from "../src/types/auth.types";
import { SAMPLE_SPEC_BODY } from "./lib/aws-section-fixture";
import { DEV_PASSWORD, resetVerifierStandingSpecs } from "./lib/verifier-harness";

const productId = process.argv[2];
const kavyaId = process.argv[3];
const priyaId = process.argv[4];
const sanjayId = process.argv[5];
if (!productId || !kavyaId || !priyaId || !sanjayId) {
  console.error("Usage: verify-b24-check7.ts <productId> <kavyaId> <priyaId> <sanjayId>");
  process.exit(1);
}

function actor(userId: string, role: Role): JwtAccessPayload {
  return { userId, role, departmentId: null };
}

async function main() {
  await drainDocumentRenderQueues(10_000);
  await resetVerifierStandingSpecs(productId);

  const created = await createSpec(productId, SAMPLE_SPEC_BODY, actor(kavyaId, Role.QC_EXEC));
  await submitSpec(created.id, actor(kavyaId, Role.QC_EXEC));
  await approveSpec(created.id, DEV_PASSWORD, actor(priyaId, Role.QC_MGR));
  await signSpec(created.id, DEV_PASSWORD, actor(sanjayId, Role.QA_MGR));
  await drainDocumentRenderQueues(60_000);

  const specRow = await prisma.spec.findUniqueOrThrow({ where: { id: created.id } });
  const attachments = await prisma.fileAttachment.findMany({
    where: { specId: created.id, fileType: FileType.DOCX },
  });
  const specAtt = attachments.find((a) => a.filePath.includes("/SPEC_"));
  const moaAtt = attachments.find((a) => a.filePath.includes("/MOA_"));

  const raw = {
    specStatus: specRow.status,
    renderStatus: specRow.renderStatus,
    attachmentCount: attachments.length,
    specAttachment: specAtt ? { id: specAtt.id, filePath: specAtt.filePath } : null,
    moaAttachment: moaAtt ? { id: moaAtt.id, filePath: moaAtt.filePath } : null,
  };
  console.log(JSON.stringify(raw, null, 2));

  if (specRow.status !== StandingDocStatus.QA_SIGNED) {
    throw new Error(`SPEC must remain QA_SIGNED, got ${specRow.status}`);
  }
  if (!specAtt) throw new Error("SPEC DOCX must persist when MOA generate fails");
  if (moaAtt) throw new Error("MOA DOCX must not persist when generate fails");
  if (specRow.renderStatus !== RenderStatus.RENDERED) {
    throw new Error(`Partial success must mark RENDERED, got ${specRow.renderStatus}`);
  }
  console.log("MOA_GENERATE_FAIL_DECOUPLED: SPEC persisted, MOA skipped, QA_SIGNED held");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
