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
import {
  approveSpec,
  findBatchReadySpec,
  listActiveSpecsForProduct,
  reviseSpec,
  signSpec,
  submitSpec,
} from "../src/modules/specs/specs.service";
import {
  DEV_PASSWORD,
  EXPECTED_TEST_COUNT,
  cleanupVerifierHarnessData,
  ensureQaSignedHarnessSpec,
  ensureVerifierActiveMaster,
  ensureVerifierProduct,
} from "./lib/verifier-harness";
import { assertBatchLocked } from "../src/modules/batches/batches-guards";
import { patchAwsSectionByManager } from "../src/modules/aws/aws.service";
import { documentStorage } from "../src/services/document-storage.service";
import { getSpecDetail } from "../src/modules/specs/specs.service";
import { AuditAction, AuditEntityType } from "../src/services/audit.service";
import bcrypt from "bcrypt";
import { DeptName } from "@prisma/client";

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
  await ensureVerifierActiveMaster(kavya.id);

  const signedSpec = await ensureQaSignedHarnessSpec(
    verifierProduct.id,
    kavya.id,
    priya.id,
    sanjay.id,
  );
  const olderSpecId = signedSpec.id;
  const olderTestNames = (
    await prisma.specTest.findMany({
      where: { specId: olderSpecId },
      orderBy: { sortOrder: "asc" },
      select: { testName: true },
    })
  ).map((t) => t.testName);

  // #2 C-1 — two concurrent active SPECs; batch may select the older one
  const revision = await reviseSpec(olderSpecId, actor(kavya.id, Role.QC_EXEC));
  await submitSpec(revision.id, actor(kavya.id, Role.QC_EXEC));
  await approveSpec(revision.id, DEV_PASSWORD, actor(priya.id, Role.QC_MGR));
  await signSpec(revision.id, DEV_PASSWORD, actor(sanjay.id, Role.QA_MGR));

  // Distinguish newer SPEC so snapshot-of-older is unambiguous
  await prisma.specTest.updateMany({
    where: { specId: revision.id },
    data: { testName: "NEWER-SPEC-MUTATED" },
  });

  const activeSpecs = await listActiveSpecsForProduct(verifierProduct.id);
  if (activeSpecs.length !== 2) {
    failures.push(`#2 C-1: expected 2 active SPECs, got ${activeSpecs.length}`);
  }
  if (activeSpecs[0]?.id !== revision.id || activeSpecs[1]?.id !== olderSpecId) {
    failures.push("#2 C-1: active-specs should return newest first (R-02 then R-01)");
  }

  const standingTestCount = await prisma.specTest.count({ where: { specId: olderSpecId } });
  if (standingTestCount !== EXPECTED_TEST_COUNT) {
    failures.push(
      `Standing SPEC should have ${EXPECTED_TEST_COUNT} tests, found ${standingTestCount}`,
    );
  }
  const batchNo = `VFY-S3-${Date.now()}`;

  // 2 — Create batch selecting OLDER SPEC (not latest)
  const created = await createBatch(
    verifierProduct.id,
    {
      sourceSpecId: olderSpecId,
      batchNo,
      assignedQcExecId: kavya.id,
      batchSize: "100 kg",
    },
    actor(priya.id, Role.QC_MGR),
  );

  if (created.batch.sourceSpecId !== olderSpecId) {
    failures.push("#2 C-1: batch sourceSpecId should be the selected older SPEC");
  }
  const snapshotNames = created.batch.specDocTests.map((t) => t.testName).sort();
  if (JSON.stringify(snapshotNames) !== JSON.stringify([...olderTestNames].sort())) {
    failures.push(
      `#2 C-1: batch snapshot should match older SPEC tests, not latest (got ${snapshotNames.join(",")})`,
    );
  }
  if (snapshotNames.some((n) => n === "NEWER-SPEC-MUTATED")) {
    failures.push("#2 C-1: batch incorrectly snapshotted the newer SPEC");
  }

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

  // 3 — Non-signed / wrong product SPEC → 409
  const orphan = await prisma.product.create({ data: { name: `Orphan-S3-${Date.now()}` } });
  const noSpec = await expectThrows(
    () =>
      createBatch(
        orphan.id,
        {
          sourceSpecId: olderSpecId,
          batchNo: `ORPH-${Date.now()}`,
          assignedQcExecId: kavya.id,
        },
        actor(priya.id, Role.QC_MGR),
      ),
    "Batch with SPEC not belonging to product",
  );
  if (noSpec) failures.push(noSpec);

  const draftSpec = await prisma.spec.create({
    data: {
      productId: verifierProduct.id,
      variant: "GENERAL",
      specNo: "SPEC/VFY/DRAFT",
      revisionNo: 99,
      status: StandingDocStatus.DRAFT,
      createdById: kavya.id,
    },
  });
  const unsignedSpec = await expectThrows(
    () =>
      createBatch(
        verifierProduct.id,
        {
          sourceSpecId: draftSpec.id,
          batchNo: `UNSIGNED-${Date.now()}`,
          assignedQcExecId: kavya.id,
        },
        actor(priya.id, Role.QC_MGR),
      ),
    "Batch with non-signed SPEC",
  );
  if (unsignedSpec) failures.push(unsignedSpec);
  await prisma.spec.delete({ where: { id: draftSpec.id } });
  await prisma.product.delete({ where: { id: orphan.id } });

  // 4 — Snapshot immutability after standing SPEC revise/mutate
  await prisma.specTest.updateMany({
    where: { specId: olderSpecId },
    data: { testName: "MUTATED-TEST-NAME" },
  });
  const batchAfterMutate = await getBatchById(created.batch.id, actor(priya.id, Role.QC_MGR));
  const frozenAfter = batchAfterMutate.specDocTests.map((t) => t.testName).sort();
  if (JSON.stringify(frozenBefore) !== JSON.stringify(frozenAfter)) {
    failures.push("#3/#4 snapshot immutability: batch spec_document_tests changed after standing SPEC mutation");
  }
  // restore standing tests for any later assertions that match by name
  for (let i = 0; i < olderTestNames.length; i++) {
    const tests = await prisma.specTest.findMany({
      where: { specId: olderSpecId },
      orderBy: { sortOrder: "asc" },
    });
    if (tests[i] && olderTestNames[i]) {
      await prisma.specTest.update({
        where: { id: tests[i]!.id },
        data: { testName: olderTestNames[i]! },
      });
    }
  }

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

  // 7 — AWS submit + QC approve; then C-4 manager edit + sign guard
  await transitionDocument(awsDoc!.id, "SUBMIT", actor(kavya.id, Role.QC_EXEC), DEV_PASSWORD);
  await transitionDocument(awsDoc!.id, "APPROVE", actor(priya.id, Role.QC_MGR), DEV_PASSWORD);

  // #6 C-4 — missing reason → validation failure
  const missingReason = await expectThrows(
    () =>
      patchAwsSectionByManager(
        awsDoc!.id,
        description.id,
        { readings: { passFail: "PASS" }, reason: "" } as never,
        { readings: { passFail: "PASS" }, reason: "" },
        actor(priya.id, Role.QC_MGR),
      ),
    "C-4 missing reason",
  );
  if (missingReason) failures.push(`#6 ${missingReason}`);

  const managerEdit = await patchAwsSectionByManager(
    awsDoc!.id,
    description.id,
    {
      readings: { passFail: "PASS", remarks: "mgr-edit" },
      reason: "Corrected remarks before QA sign",
    },
    { readings: { passFail: "PASS", remarks: "mgr-edit" }, reason: "Corrected remarks before QA sign" },
    actor(priya.id, Role.QC_MGR),
  );
  if (!managerEdit) failures.push("#6 C-4 manager edit returned empty");

  const changeHistory = await prisma.auditLog.findFirst({
    where: {
      entityType: AuditEntityType.AWS,
      entityId: awsDoc!.id,
      action: AuditAction.AWS_MANAGER_EDIT,
      userId: priya.id,
    },
  });
  if (!changeHistory || !changeHistory.comment?.includes("Corrected remarks")) {
    failures.push("#6 C-4 change-history row missing after manager edit");
  }

  // #7 C-4 — QA signer who edited (simulated) → 403; different QA_MGR → OK
  await prisma.auditLog.create({
    data: {
      timestamp: new Date(),
      userId: sanjay.id,
      userName: sanjay.fullName,
      role: Role.QA_MGR,
      action: AuditAction.AWS_MANAGER_EDIT,
      entityType: AuditEntityType.AWS,
      entityId: awsDoc!.id,
      docNo: awsDoc!.docNo,
      fieldChanged: "readings",
      oldValue: "old",
      newValue: "new",
      comment: "C-4 guard test: simulated QA_MGR edit",
    },
  });

  const editorSign = await expectThrows(
    () => transitionDocument(awsDoc!.id, "SIGN", actor(sanjay.id, Role.QA_MGR), DEV_PASSWORD),
    "QA signer who edited",
  );
  if (editorSign) failures.push(`#7 ${editorSign}`);

  let altQa = await prisma.user.findFirst({ where: { username: "neha.qa", deletedAt: null } });
  if (!altQa) {
    const qaDept = await prisma.department.findFirst({ where: { name: DeptName.QA } });
    altQa = await prisma.user.create({
      data: {
        fullName: "Neha QA",
        username: "neha.qa",
        email: "neha.qa@acqms.local",
        passwordHash: await bcrypt.hash(DEV_PASSWORD, 12),
        role: Role.QA_MGR,
        departmentId: qaDept!.id,
        forcePwdChange: false,
      },
    });
  }

  await transitionDocument(awsDoc!.id, "SIGN", actor(altQa.id, Role.QA_MGR), DEV_PASSWORD);

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

  // C-2 attribution on AWS + SPEC + batch
  const awsDetail = await getDocumentDetail(awsDoc!.id, actor(altQa.id, Role.QA_MGR));
  if (!awsDetail.signatureLineage?.qaSigned?.user?.id) {
    failures.push("#9 C-2: AWS signatureLineage.qaSigned missing after sign");
  }
  const specDetail = await getSpecDetail(olderSpecId, actor(kavya.id, Role.QC_EXEC));
  if (!specDetail.signatureLineage?.authored?.user?.displayName) {
    failures.push("#9 C-2: SPEC signatureLineage.authored missing");
  }
  const batchDetail = await getBatchById(created.batch.id, actor(priya.id, Role.QC_MGR));
  if (!batchDetail.signatureLineage?.authored?.user?.id) {
    failures.push("#9 C-2: batch signatureLineage.authored missing");
  }

  await signAndIssueCoa(coaDoc!.id, actor(altQa.id, Role.QA_MGR), DEV_PASSWORD);

  const released = await getBatchById(created.batch.id, actor(altQa.id, Role.QA_MGR));
  if (released.status !== BatchStatus.RELEASED) failures.push("Batch should be RELEASED");

  const coaDetail = await getDocumentDetail(coaDoc!.id, actor(altQa.id, Role.QA_MGR));
  if (!coaDetail.signatureLineage) {
    failures.push("#9 C-2: COA signatureLineage missing");
  }

  const renderAudits = await prisma.auditLog.count({
    where: {
      action: "GENERATE",
      comment: { contains: "Epic 21" },
    },
  });
  if (renderAudits < 1) failures.push("renderDocuments stub audit not found");

  // #10 storage seam
  const resolved = documentStorage.resolvePath({
    productCode: "VFY",
    batchNo: batchNo,
    docType: "AWS",
    docNo: awsDoc!.docNo,
    ext: "docx",
    generatedBy: "system",
  });
  if (!resolved.relativePath.includes("VFY") || !resolved.relativePath.includes(batchNo)) {
    failures.push(`#10 resolvePath incorrect: ${resolved.relativePath}`);
  }

  // #10 ARN concurrency + QA-09 format
  await prisma.$transaction(async (tx) => {
    const [a, b] = await Promise.all([
      generateArn(tx, { productId: verifierProduct.id, productCode: "VFY" }),
      generateArn(tx, { productId: verifierProduct.id, productCode: "VFY" }),
    ]);
    if (a.arn === b.arn) failures.push("ARN concurrency: duplicate sequences in same tx");
    const year = String(new Date().getUTCFullYear());
    if (!a.arn.startsWith(`${year} VFY `)) {
      failures.push(`#10 QA-09 ARN format unexpected: ${a.arn}`);
    }
  });

  // 11 — structural checks
  const moaRoute = checkNoStandaloneMoaRoutes();
  if (moaRoute) failures.push(moaRoute);

  const prismaCheck = checkPrismaOnlyInRepositories();
  if (prismaCheck) failures.push(prismaCheck);

  // 8 — S1/S2 regression (run as subprocess after cleanup)
  await cleanupVerifierHarnessData(verifierProduct.id);
  await prisma.user.updateMany({
    where: { username: "neha.qa" },
    data: { deletedAt: new Date(), username: `neha.qa.deleted.${Date.now()}`, email: `neha.qa.deleted.${Date.now()}@acqms.local` },
  });

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
