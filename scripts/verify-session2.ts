import "dotenv/config";
import { Role, StandingDocStatus } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";
import { prisma } from "../src/lib/prisma-types";
import { AppError } from "../src/lib/app-error";
import { AuditAction, AuditEntityType } from "../src/services/audit.service";
import { JwtAccessPayload } from "../src/types/auth.types";
import {
  approveSpec,
  createSpec,
  findBatchReadySpec,
  rejectSpec,
  reviseSpec,
  signSpec,
  submitSpec,
} from "../src/modules/specs/specs.service";
import {
  DEV_PASSWORD,
  EXPECTED_TEST_COUNT,
  SAMPLE_SPEC_BODY,
  cleanupVerifierHarnessData,
  ensureVerifierActiveMaster,
  ensureVerifierProduct,
  resetVerifierStandingSpecs,
} from "./lib/verifier-harness";

function actor(userId: string, role: Role, departmentId: string | null = null): JwtAccessPayload {
  return { userId, role, departmentId };
}

async function getUser(username: string) {
  const user = await prisma.user.findFirst({ where: { username, deletedAt: null } });
  if (!user) throw new Error(`User ${username} not found`);
  return user;
}

async function expectThrows(fn: () => Promise<unknown>, label: string) {
  try {
    await fn();
    return `${label}: expected failure but succeeded`;
  } catch (error) {
    if (!(error instanceof AppError)) {
      return `${label}: unexpected error ${error}`;
    }
  }
  return null;
}

function checkNoStandaloneMoaRoutes(): string | null {
  const indexSrc = readFileSync(
    join(__dirname, "../src/routes/index.ts"),
    "utf8",
  );
  if (indexSrc.includes("/moa")) {
    return "Standalone /moa route found in routes/index.ts";
  }
  return null;
}

async function main() {
  const failures: string[] = [];

  const kavya = await getUser("kavya.patel");
  const priya = await getUser("priya.mehta");
  const sanjay = await getUser("sanjay.reddy");

  const verifierProduct = await ensureVerifierProduct();
  await ensureVerifierActiveMaster(kavya.id);

  await cleanupVerifierHarnessData(verifierProduct.id);
  await resetVerifierStandingSpecs(verifierProduct.id);

  // 2 — Author SPEC+MOA
  const created = await createSpec(
    verifierProduct.id,
    SAMPLE_SPEC_BODY,
    actor(kavya.id, Role.QC_EXEC, kavya.departmentId),
  );

  if (created.status !== StandingDocStatus.DRAFT) {
    failures.push(`Expected DRAFT after create, got ${created.status}`);
  }
  if (created.tests.length !== EXPECTED_TEST_COUNT || !created.moa || created.moa.sections.length !== EXPECTED_TEST_COUNT) {
    failures.push(
      `SPEC+MOA pair not created with expected ${EXPECTED_TEST_COUNT} tests/sections (got ${created.tests.length}/${created.moa?.sections.length ?? 0})`,
    );
  }

  const createAudit = await prisma.auditLog.findFirst({
    where: {
      entityType: AuditEntityType.SPEC,
      entityId: created.id,
      action: AuditAction.CREATE,
    },
  });
  if (!createAudit) {
    failures.push("Audit CREATE for SPEC not found");
  }

  // 3 — No ACTIVE master → 409
  const orphan = await prisma.product.create({ data: { name: `Orphan-${Date.now()}` } });
  const noMaster = await expectThrows(
    () =>
      createSpec(
        orphan.id,
        SAMPLE_SPEC_BODY,
        actor(kavya.id, Role.QC_EXEC, kavya.departmentId),
      ),
    "Create without ACTIVE master",
  );
  if (noMaster) failures.push(noMaster);
  await prisma.product.delete({ where: { id: orphan.id } });

  // 4 — Submit
  const submitted = await submitSpec(created.id, actor(kavya.id, Role.QC_EXEC, kavya.departmentId));
  if (submitted.status !== StandingDocStatus.SUBMITTED) {
    failures.push(`Submit: expected SUBMITTED, got ${submitted.status}`);
  }
  if (submitted.moa?.status !== StandingDocStatus.SUBMITTED) {
    failures.push("Submit: MOA did not mirror SUBMITTED");
  }

  // 7 — Self-approval (author as QC_MGR actor)
  const selfApprove = await expectThrows(
    () =>
      approveSpec(
        created.id,
        DEV_PASSWORD,
        actor(kavya.id, Role.QC_MGR, kavya.departmentId),
      ),
    "Author self-approve",
  );
  if (selfApprove) failures.push(selfApprove);

  // 8 — Reject without comment
  const noComment = await expectThrows(
    () =>
      rejectSpec(created.id, "", actor(priya.id, Role.QC_MGR, priya.departmentId)),
    "Reject without comment",
  );
  if (noComment) failures.push(noComment);

  // 9 — Approve without password
  const noPassword = await expectThrows(
    () =>
      approveSpec(created.id, "", actor(priya.id, Role.QC_MGR, priya.departmentId)),
    "Approve without password",
  );
  if (noPassword) failures.push(noPassword);

  // 5 — Approve
  const approved = await approveSpec(
    created.id,
    DEV_PASSWORD,
    actor(priya.id, Role.QC_MGR, priya.departmentId),
  );
  if (approved.status !== StandingDocStatus.QC_APPROVED) {
    failures.push(`Approve: expected QC_APPROVED, got ${approved.status}`);
  }

  // 9b — Sign without password
  const noSignPassword = await expectThrows(
    () => signSpec(created.id, "", actor(sanjay.id, Role.QA_MGR, sanjay.departmentId)),
    "Sign without password",
  );
  if (noSignPassword) failures.push(noSignPassword);

  // 6 — Sign + render stub
  const signed = await signSpec(
    created.id,
    DEV_PASSWORD,
    actor(sanjay.id, Role.QA_MGR, sanjay.departmentId),
  );
  if (signed.status !== StandingDocStatus.QA_SIGNED) {
    failures.push(`Sign: expected QA_SIGNED, got ${signed.status}`);
  }
  if (signed.moa?.status !== StandingDocStatus.QA_SIGNED) {
    failures.push("Sign: MOA did not mirror QA_SIGNED");
  }

  const renderAudit = await prisma.auditLog.findFirst({
    where: {
      entityType: AuditEntityType.SPEC,
      entityId: created.id,
      action: AuditAction.GENERATE,
    },
  });
  if (!renderAudit) {
    failures.push("renderDocuments stub did not write GENERATE audit");
  }

  const batchReady = await findBatchReadySpec(verifierProduct.id);
  if (!batchReady || batchReady.id !== created.id) {
    failures.push("findBatchReadySpec should return signed SPEC after first sign");
  }

  // 10 — No standalone MOA routes
  const moaRoute = checkNoStandaloneMoaRoutes();
  if (moaRoute) failures.push(moaRoute);

  // 11 — Revise DRAFT → 409
  const draftSpec = await prisma.spec.create({
    data: {
      productId: verifierProduct.id,
      variant: "GENERAL",
      specNo: "SPEC/TEST/99",
      revisionNo: 99,
      status: StandingDocStatus.DRAFT,
      createdById: kavya.id,
    },
  });
  const reviseDraftFail = await expectThrows(
    () => reviseSpec(draftSpec.id, actor(kavya.id, Role.QC_EXEC, kavya.departmentId)),
    "Revise DRAFT spec",
  );
  if (reviseDraftFail) failures.push(reviseDraftFail);
  await prisma.spec.delete({ where: { id: draftSpec.id } });

  // 12 — Revise QA_SIGNED
  const revision = await reviseSpec(created.id, actor(kavya.id, Role.QC_EXEC, kavya.departmentId));
  if (revision.status !== StandingDocStatus.DRAFT) {
    failures.push(`Revise: expected new DRAFT, got ${revision.status}`);
  }
  if (revision.revisionNo !== created.revisionNo + 1) {
    failures.push(`Revise: expected revision ${created.revisionNo + 1}`);
  }
  if (revision.supersedesId !== created.id) {
    failures.push("Revise: supersedes_id not set");
  }
  if (revision.tests.length !== EXPECTED_TEST_COUNT || !revision.moa || revision.moa.sections.length !== EXPECTED_TEST_COUNT) {
    failures.push(`Revise: expected ${EXPECTED_TEST_COUNT} tests/MOA sections copied`);
  }

  const sourceAfterRevise = await prisma.spec.findUnique({ where: { id: created.id } });
  if (sourceAfterRevise?.status !== StandingDocStatus.QA_SIGNED) {
    failures.push("Revise: source SPEC should remain QA_SIGNED");
  }

  // 15 — No-gap: batch-ready still prior signed spec
  const batchReadyDuringGap = await findBatchReadySpec(verifierProduct.id);
  if (!batchReadyDuringGap || batchReadyDuringGap.id !== created.id) {
    failures.push("No-gap: batch-ready should still be prior signed SPEC before new revision signs");
  }

  // 13 — Second revise while DRAFT open
  const secondRevise = await expectThrows(
    () => reviseSpec(created.id, actor(kavya.id, Role.QC_EXEC, kavya.departmentId)),
    "Second revise while in-flight",
  );
  if (secondRevise) failures.push(secondRevise);

  // 14 — New revision through workflow → supersede prior
  await submitSpec(revision.id, actor(kavya.id, Role.QC_EXEC, kavya.departmentId));
  await approveSpec(
    revision.id,
    DEV_PASSWORD,
    actor(priya.id, Role.QC_MGR, priya.departmentId),
  );
  await signSpec(
    revision.id,
    DEV_PASSWORD,
    actor(sanjay.id, Role.QA_MGR, sanjay.departmentId),
  );

  const oldSpec = await prisma.spec.findUnique({
    where: { id: created.id },
    include: { moaDoc: true },
  });
  if (oldSpec?.status !== StandingDocStatus.SUPERSEDED) {
    failures.push("Supersede-on-sign: prior SPEC should be SUPERSEDED");
  }
  if (oldSpec?.moaDoc?.status !== StandingDocStatus.SUPERSEDED) {
    failures.push("Supersede-on-sign: prior MOA should be SUPERSEDED");
  }

  const qaSignedCount = await prisma.spec.count({
    where: {
      productId: verifierProduct.id,
      variant: "GENERAL",
      status: StandingDocStatus.QA_SIGNED,
    },
  });
  if (qaSignedCount !== 1) {
    failures.push(`Expected exactly 1 QA_SIGNED spec, found ${qaSignedCount}`);
  }

  const batchReadyAfter = await findBatchReadySpec(verifierProduct.id);
  if (!batchReadyAfter || batchReadyAfter.id !== revision.id) {
    failures.push("After sign, batch-ready should be new revision");
  }

  report(failures);
}

function report(failures: string[]) {
  if (failures.length > 0) {
    console.error("Session 2 verification FAILED:");
    for (const f of failures) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  }
  console.log("Session 2 verification PASSED");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
