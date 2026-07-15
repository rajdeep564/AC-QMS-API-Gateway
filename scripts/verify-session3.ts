import "dotenv/config";
import { execSync } from "child_process";
import {
  BatchStatus,
  CoaComplianceVerdict,
  DocStatus,
  DocType,
  Role,
  SectionStatus,
  StandingDocStatus,
} from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";
import { prisma } from "../src/lib/prisma-types";
import { AppError } from "../src/lib/app-error";
import { generateArn } from "../src/services/arn-generator";
import { JwtAccessPayload } from "../src/types/auth.types";
import {
  approveBatch,
  createBatch,
  getBatchById,
  rejectBatch,
  submitBatch,
} from "../src/modules/batches/batches.service";
import {
  acknowledgeExpiredSection,
  acknowledgeOosSection,
  checkAwsSection,
  completeAwsSection,
} from "../src/modules/aws/aws-compliance.service";
import {
  getAwsSectionDetail,
  patchAwsSection,
  previewAwsSection,
} from "../src/modules/aws/aws.service";
import {
  getDocumentDetail,
  signAndIssueCoa,
  transitionDocument,
} from "../src/modules/documents/documents.service";
import { findBatchReadySpec } from "../src/modules/specs/specs.service";
import {
  DEV_PASSWORD,
  EXPECTED_TEST_COUNT,
  cleanupVerifierHarnessData,
  ensureQaSignedHarnessSpec,
  ensureVerifierProduct,
} from "./lib/verifier-harness";
import { assertBatchLocked } from "../src/modules/batches/batches-guards";

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

function passingReadingsForTest(test: {
  resultType: string;
  operator: string | null;
  minValue: { toString(): string } | null;
  maxValue: { toString(): string } | null;
}): Record<string, unknown> {
  if (test.resultType === "QUALITATIVE") {
    return { passFail: "PASS" };
  }
  const min = test.minValue ? Number(test.minValue.toString()) : null;
  const max = test.maxValue ? Number(test.maxValue.toString()) : null;
  if (test.operator === "BETWEEN" && min != null && max != null) {
    return { variables: { result: (min + max) / 2 } };
  }
  if (test.operator === "NMT" && max != null) {
    return { variables: { result: max * 0.5 } };
  }
  if (test.operator === "NLT" && min != null) {
    return { variables: { result: min * 1.01 } };
  }
  return { variables: { result: 1 } };
}

async function completeAwsSectionPair(
  sectionId: string,
  readings: Record<string, unknown>,
  analystId: string,
  checkerId: string,
) {
  await patchAwsSection(
    sectionId,
    { readings },
    { readings },
    actor(analystId, Role.QC_EXEC),
  );
  await completeAwsSection(sectionId, actor(analystId, Role.QC_EXEC));
  await checkAwsSection(
    sectionId,
    { password: DEV_PASSWORD },
    actor(checkerId, Role.QC_EXEC),
  );
}

function checkNoStandaloneMoaRoutes(): string | null {
  const indexSrc = readFileSync(join(__dirname, "../src/routes/index.ts"), "utf8");
  if (indexSrc.includes("/moa")) return "Standalone /moa route found in routes/index.ts";
  return null;
}

function checkPrismaOnlyInRepositories(): string | null {
  const serviceFiles = [
    "src/modules/batches/batches.service.ts",
    "src/modules/aws/aws.service.ts",
    "src/modules/documents/documents.service.ts",
  ];
  for (const file of serviceFiles) {
    const src = readFileSync(join(__dirname, "..", file), "utf8");
    if (/prisma\.\w+\(/.test(src) && !src.includes("prisma.$transaction")) {
      return `${file} contains direct prisma calls outside $transaction`;
    }
  }
  return null;
}

function runVerifyScript(script: string): string | null {
  try {
    execSync(`npm run ${script}`, {
      cwd: join(__dirname, ".."),
      stdio: "pipe",
      encoding: "utf8",
    });
    return null;
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    return output
      ? `${script} regression failed:\n${output}`
      : `${script} regression failed${err.message ? `: ${err.message}` : ""}`;
  }
}

function report(failures: string[]) {
  if (failures.length === 0) {
    console.log("verify:session3 — ALL CHECKS PASSED");
    process.exit(0);
  }
  console.error("verify:session3 — FAILURES:");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}

async function main() {
  const failures: string[] = [];

  // 1 — typecheck
  try {
    execSync("npm run typecheck", { cwd: join(__dirname, ".."), stdio: "pipe" });
  } catch {
    failures.push("npm run typecheck failed");
  }

  const kavya = await getUser("kavya.patel");
  const meera = await getUser("meera.iyer");
  const priya = await getUser("priya.mehta");
  const sanjay = await getUser("sanjay.reddy");

  const verifierProduct = await ensureVerifierProduct();

  const signedSpec = await ensureQaSignedHarnessSpec(
    verifierProduct.id,
    kavya.id,
    priya.id,
    sanjay.id,
  );
  const standingTestCount = await prisma.specTest.count({ where: { specId: signedSpec.id } });
  if (standingTestCount !== EXPECTED_TEST_COUNT) {
    failures.push(
      `Standing SPEC should have ${EXPECTED_TEST_COUNT} tests, found ${standingTestCount}`,
    );
  }
  const batchNo = `VFY-S3-${Date.now()}`;

  // 2 — Create batch with snapshot
  const created = await createBatch(
    verifierProduct.id,
    {
      sourceSpecId: signedSpec.id,
      batchNo,
      assignedQcExecId: kavya.id,
      batchSize: "100 kg",
    },
    actor(priya.id, Role.QC_MGR),
  );

  if (!created.batch.arnNo) failures.push("Batch missing ARN");
  if (created.batch.specDocTests.length !== standingTestCount) {
    failures.push(
      `Snapshot test count mismatch: batch has ${created.batch.specDocTests.length}, standing SPEC has ${standingTestCount}`,
    );
  }
  if (created.batch.moaDocSections.length !== standingTestCount) {
    failures.push(
      `Snapshot MOA section count mismatch: batch has ${created.batch.moaDocSections.length}, standing SPEC has ${standingTestCount}`,
    );
  }
  if (created.batch.batchDocuments.length !== 2) failures.push("Expected AWS+COA documents");

  const awsPending = created.batch.batchDocuments.find((d) => d.docType === DocType.AWS);
  const coaPending = created.batch.batchDocuments.find((d) => d.docType === DocType.COA);
  if (awsPending?.status !== DocStatus.PENDING) failures.push("AWS should be PENDING");
  if (coaPending?.status !== DocStatus.PENDING) failures.push("COA should be PENDING");

  const snapshotTestNames = created.batch.specDocTests.map((t) => t.testName).sort();
  const frozenBefore = [...snapshotTestNames];

  // 3 — No QA_SIGNED spec → 409
  const orphan = await prisma.product.create({ data: { name: `Orphan-S3-${Date.now()}` } });
  const noSpec = await expectThrows(
    () =>
      createBatch(
        orphan.id,
        {
          sourceSpecId: signedSpec.id,
          batchNo: `ORPH-${Date.now()}`,
          assignedQcExecId: kavya.id,
        },
        actor(priya.id, Role.QC_MGR),
      ),
    "Batch without QA_SIGNED spec",
  );
  if (noSpec) failures.push(noSpec);
  await prisma.product.delete({ where: { id: orphan.id } });

  // 4 — Snapshot immutability after standing SPEC revise
  await prisma.specTest.updateMany({
    where: { specId: signedSpec.id },
    data: { testName: "MUTATED-TEST-NAME" },
  });
  const batchAfterMutate = await getBatchById(created.batch.id, actor(priya.id, Role.QC_MGR));
  const frozenAfter = batchAfterMutate.specDocTests.map((t) => t.testName).sort();
  if (JSON.stringify(frozenBefore) !== JSON.stringify(frozenAfter)) {
    failures.push("#4 snapshot immutability: batch spec_document_tests changed after standing SPEC mutation");
  }
  await prisma.specTest.updateMany({
    where: { specId: signedSpec.id, testName: "MUTATED-TEST-NAME" },
    data: { testName: frozenBefore[0] ?? "Description" },
  });

  // 5 — Batch lock + AWS open
  await submitBatch(created.batch.id, actor(priya.id, Role.QC_MGR));
  await approveBatch(created.batch.id, DEV_PASSWORD, actor(sanjay.id, Role.QA_MGR));

  const approved = await getBatchById(created.batch.id, actor(priya.id, Role.QC_MGR));
  if (approved.status !== BatchStatus.APPROVED) failures.push("Batch should be APPROVED");

  const lockedEdit = await expectThrows(
    () => assertBatchLocked(created.batch.id),
    "Edit locked batch",
  );
  if (lockedEdit) failures.push(`#5 batch lock: ${lockedEdit}`);

  const awsDoc = await prisma.batchDocument.findFirst({
    where: { batchId: created.batch.id, docType: DocType.AWS },
  });
  if (!awsDoc || awsDoc.status !== DocStatus.DRAFT) {
    failures.push("#5 AWS should open to DRAFT after batch approve");
  }

  const sections = await prisma.awsSection.findMany({
    where: { batchDocumentId: awsDoc!.id },
    include: { specDocumentTest: true },
    orderBy: { specDocumentTest: { sortOrder: "asc" } },
  });
  if (sections.length !== standingTestCount) {
    failures.push(`Expected ${standingTestCount} AWS sections seeded, got ${sections.length}`);
  }

  const description =
    sections.find((s) => s.specDocumentTest.testName === "Description") ?? sections[0]!;
  const assay =
    sections.find((s) => s.specDocumentTest.testName === "Assay") ??
    sections[sections.length - 1]!;

  const rejectClientCalc = await expectThrows(
    () =>
      patchAwsSection(
        description.id,
        { readings: { passFail: "PASS" } },
        { readings: { passFail: "PASS" }, calculatedResult: 99.9 },
        actor(kavya.id, Role.QC_EXEC),
      ),
    "Reject client calculatedResult",
  );
  if (rejectClientCalc) failures.push(rejectClientCalc);

  await patchAwsSection(
    description.id,
    { readings: { passFail: "PASS" } },
    { readings: { passFail: "PASS" } },
    actor(kavya.id, Role.QC_EXEC),
  );
  await completeAwsSection(description.id, actor(kavya.id, Role.QC_EXEC));

  const sameChecker = await expectThrows(
    () =>
      checkAwsSection(description.id, { password: DEV_PASSWORD }, actor(kavya.id, Role.QC_EXEC)),
    "Analyst cannot check own section",
  );
  if (sameChecker) failures.push(sameChecker);

  await checkAwsSection(description.id, { password: DEV_PASSWORD }, actor(meera.id, Role.QC_EXEC));

  for (const section of sections) {
    const name = section.specDocumentTest.testName;
    if (name === "Description" || name === "Assay") continue;
    const readings = passingReadingsForTest(section.specDocumentTest);
    await completeAwsSectionPair(section.id, readings, kavya.id, meera.id);
  }

  // OOS on assay
  await patchAwsSection(
    assay.id,
    { readings: { variables: { result: 95.0 } } },
    { readings: { variables: { result: 95.0 } } },
    actor(kavya.id, Role.QC_EXEC),
  );
  const previewOos = await previewAwsSection(
    assay.id,
    { readings: { variables: { result: 95.0 } } },
    actor(kavya.id, Role.QC_EXEC),
  );
  if (!previewOos.isOos) failures.push("Expected OOS for assay below minimum limit");

  const oosBlock = await expectThrows(
    () => completeAwsSection(assay.id, actor(kavya.id, Role.QC_EXEC)),
    "OOS without acknowledgement",
  );
  if (oosBlock) failures.push(oosBlock);

  await acknowledgeOosSection(
    assay.id,
    { comment: "OOS acknowledged for verify" },
    actor(kavya.id, Role.QC_EXEC),
  );
  await completeAwsSection(assay.id, actor(kavya.id, Role.QC_EXEC));
  await checkAwsSection(assay.id, { password: DEV_PASSWORD }, actor(meera.id, Role.QC_EXEC));

  const allComplete = await prisma.awsSection.count({
    where: { batchDocumentId: awsDoc!.id, status: SectionStatus.COMPLETE },
  });
  if (allComplete !== standingTestCount) {
    failures.push(`All ${standingTestCount} AWS sections should be COMPLETE, got ${allComplete}`);
  }

  // 7 — AWS sign → COA auto-gen → sign-and-issue → RELEASED
  await transitionDocument(awsDoc!.id, "SUBMIT", actor(kavya.id, Role.QC_EXEC));
  await transitionDocument(awsDoc!.id, "APPROVE", actor(priya.id, Role.QC_MGR), DEV_PASSWORD);
  await transitionDocument(awsDoc!.id, "SIGN", actor(sanjay.id, Role.QA_MGR), DEV_PASSWORD);

  const coaDoc = await prisma.batchDocument.findFirst({
    where: { batchId: created.batch.id, docType: DocType.COA },
    include: { coaResults: true },
  });
  if (!coaDoc || coaDoc.status !== DocStatus.AUTO_GENERATED) {
    failures.push("COA should be AUTO_GENERATED after AWS QA sign");
  }
  if (coaDoc?.complianceVerdict !== CoaComplianceVerdict.DOES_NOT_COMPLY) {
    failures.push("COA verdict should be DOES_NOT_COMPLY due to OOS assay");
  }
  if ((coaDoc?.coaResults.length ?? 0) !== standingTestCount) {
    failures.push(`COA should have ${standingTestCount} result rows`);
  }

  await signAndIssueCoa(coaDoc!.id, actor(sanjay.id, Role.QA_MGR), DEV_PASSWORD);

  const released = await getBatchById(created.batch.id, actor(sanjay.id, Role.QA_MGR));
  if (released.status !== BatchStatus.RELEASED) failures.push("Batch should be RELEASED");

  const renderAudits = await prisma.auditLog.count({
    where: {
      action: "GENERATE",
      comment: { contains: "Epic 21" },
    },
  });
  if (renderAudits < 1) failures.push("renderDocuments stub audit not found");

  // 10 — ARN concurrency
  await prisma.$transaction(async (tx) => {
    const [a, b] = await Promise.all([generateArn(tx), generateArn(tx)]);
    if (a.arn === b.arn) failures.push("ARN concurrency: duplicate sequences in same tx");
  });

  // 11 — structural checks
  const moaRoute = checkNoStandaloneMoaRoutes();
  if (moaRoute) failures.push(moaRoute);

  const prismaCheck = checkPrismaOnlyInRepositories();
  if (prismaCheck) failures.push(prismaCheck);

  // 8 — S1/S2 regression (run as subprocess after cleanup)
  await cleanupVerifierHarnessData(verifierProduct.id);

  const session1Failure = runVerifyScript("verify:session1");
  if (session1Failure) failures.push(session1Failure);

  const session2Failure = runVerifyScript("verify:session2");
  if (session2Failure) failures.push(session2Failure);

  report(failures);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
