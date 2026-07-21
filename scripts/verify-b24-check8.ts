/**
 * B-2.4 check #8 — DOC-Module unreachable during standing render; QA_SIGNED must hold.
 */
import "dotenv/config";
import { Role, StandingDocStatus } from "@prisma/client";
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
if (!productId) {
  console.error("Usage: verify-b24-check8.ts <productId>");
  process.exit(1);
}

function actor(userId: string, role: Role): JwtAccessPayload {
  return { userId, role, departmentId: null };
}

async function main() {
  const kavya = await prisma.user.findFirstOrThrow({
    where: { username: "kavya.patel", deletedAt: null },
  });
  const priya = await prisma.user.findFirstOrThrow({
    where: { username: "priya.mehta", deletedAt: null },
  });
  const sanjay = await prisma.user.findFirstOrThrow({
    where: { username: "sanjay.reddy", deletedAt: null },
  });

  await drainDocumentRenderQueues(10_000);
  await resetVerifierStandingSpecs(productId);

  const created = await createSpec(productId, SAMPLE_SPEC_BODY, actor(kavya.id, Role.QC_EXEC));
  await submitSpec(created.id, actor(kavya.id, Role.QC_EXEC));
  await approveSpec(created.id, DEV_PASSWORD, actor(priya.id, Role.QC_MGR));
  await signSpec(created.id, DEV_PASSWORD, actor(sanjay.id, Role.QA_MGR));
  await drainDocumentRenderQueues(60_000);

  const spec = await prisma.spec.findUniqueOrThrow({ where: { id: created.id } });
  console.log(
    JSON.stringify(
      {
        specId: spec.id,
        status: spec.status,
        renderStatus: spec.renderStatus,
        renderError: spec.renderError,
        docModuleUrl: process.env.DOC_MODULE_URL,
      },
      null,
      2,
    ),
  );

  if (spec.status !== StandingDocStatus.QA_SIGNED) {
    throw new Error(`Expected QA_SIGNED, got ${spec.status}`);
  }
  console.log("QA_SIGNED_HELD: workflow commit unaffected by render failure");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
