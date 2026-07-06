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
  createSpec,
  findBatchReadySpec,
  signSpec,
  submitSpec,
} from "../src/modules/specs/specs.service";
import { CreateSpecBody } from "../src/modules/specs/specs.schema";
import { assertBatchLocked } from "../src/modules/batches/batches-guards";

const DEV_PASSWORD = "Acqms@2026";

const SAMPLE_SPEC_BODY: CreateSpecBody = {
  variant: "GENERAL",
  tests: [
    {
      sortOrder: 1,
      testName: "Appearance",
      resultType: "QUALITATIVE",
      acceptanceCriteria: "White crystalline powder",
    },
    {
      sortOrder: 2,
      testName: "Assay",
      resultType: "QUANTITATIVE",
      operator: "NLT",
      minValue: 99.0,
      uom: "%",
      formula: "result",
    },
  ],
  moaSections: [
    { specTestRef: 0, pharmacopoeia: "IP", samplePreparation: "Visual inspection" },
    { specTestRef: 1, pharmacopoeia: "IP", samplePreparation: "Titrate sample" },
  ],
};

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

async function ensureQaSignedSpec(productId: string, kavyaId: string, priyaId: string, sanjayId: string) {
  await cleanupSession3Data(productId);
  await prisma.moaDocSection.deleteMany({
    where: { moaDoc: { spec: { productId } } },
  });
  await prisma.moaDoc.deleteMany({ where: { spec: { productId } } });
  await prisma.specTest.deleteMany({ where: { spec: { productId } } });
  await prisma.spec.deleteMany({ where: { productId } });

  const created = await createSpec(productId, SAMPLE_SPEC_BODY, actor(kavyaId, Role.QC_EXEC));
  await submitSpec(created.id, actor(kavyaId, Role.QC_EXEC));
  await approveSpec(created.id, DEV_PASSWORD, actor(priyaId, Role.QC_MGR));
  await signSpec(created.id, DEV_PASSWORD, actor(sanjayId, Role.QA_MGR));
  const signed = await findBatchReadySpec(productId);
  if (!signed) throw new Error("Failed to obtain QA_SIGNED spec");
  return signed;
}

async function cleanupSession3Data(productId: string) {
  const batches = await prisma.batch.findMany({ where: { productId }, select: { id: true } });
  for (const batch of batches) {
    await prisma.awsSection.deleteMany({
      where: { batchDocument: { batchId: batch.id } },
    });
    await prisma.coaResult.deleteMany({
      where: { batchDocument: { batchId: batch.id } },
    });
    await prisma.batchDocument.deleteMany({ where: { batchId: batch.id } });
    await prisma.moaDocumentSection.deleteMany({ where: { batchId: batch.id } });
    await prisma.specDocumentTest.deleteMany({ where: { batchId: batch.id } });
    await prisma.batch.delete({ where: { id: batch.id } });
  }
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

  const glycine = await prisma.product.findFirst({ where: { name: "Glycine" } });
  if (!glycine) {
    failures.push("Glycine product not found — run seed first");
    report(failures);
    return;
  }

  const signedSpec = await ensureQaSignedSpec(glycine.id, kavya.id, priya.id, sanjay.id);
  const batchNo = `GLY-S3-${Date.now()}`;

  // 2 — Create batch with snapshot
  const created = await createBatch(
    glycine.id,
    {
      sourceSpecId: signedSpec.id,
      batchNo,
      assignedQcExecId: kavya.id,
      batchSize: "100 kg",
    },
    actor(priya.id, Role.QC_MGR),
  );

  if (!created.batch.arnNo) failures.push("Batch missing ARN");
  if (created.batch.specDocTests.length !== 2) failures.push("Expected 2 snapshot tests");
  if (created.batch.moaDocSections.length !== 2) failures.push("Expected 2 MOA snapshot sections");
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
    data: { testName: frozenBefore[0] ?? "Appearance" },
  });

  // 5 — Batch lock + AWS open
  await submitBatch(created.batch.id, actor(priya.id, Role.QC_MGR));
  await approveBatch(created.batch.id, actor(sanjay.id, Role.QA_MGR));

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
  if (sections.length !== 2) failures.push("Expected 2 AWS sections seeded");

  // 6 — AWS: recompute, reject client fields, two-person, OOS, expiry
  const appearance = sections[0]!;
  const assay = sections[1]!;

  const rejectClientCalc = await expectThrows(
    () =>
      patchAwsSection(
        appearance.id,
        { readings: { passFail: "PASS" } },
        { readings: { passFail: "PASS" }, calculatedResult: 99.9 },
        actor(kavya.id, Role.QC_EXEC),
      ),
    "Reject client calculatedResult",
  );
  if (rejectClientCalc) failures.push(rejectClientCalc);

  await patchAwsSection(
    appearance.id,
    { readings: { passFail: "PASS" } },
    { readings: { passFail: "PASS" } },
    actor(kavya.id, Role.QC_EXEC),
  );
  await completeAwsSection(appearance.id, actor(kavya.id, Role.QC_EXEC));

  const sameChecker = await expectThrows(
    () =>
      checkAwsSection(appearance.id, { password: DEV_PASSWORD }, actor(kavya.id, Role.QC_EXEC)),
    "Analyst cannot check own section",
  );
  if (sameChecker) failures.push(sameChecker);

  await checkAwsSection(appearance.id, { password: DEV_PASSWORD }, actor(meera.id, Role.QC_EXEC));

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
  if (!previewOos.isOos) failures.push("Expected OOS for assay below NLT 99");

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
  if (allComplete !== 2) failures.push("All AWS sections should be COMPLETE");

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
  if ((coaDoc?.coaResults.length ?? 0) !== 2) failures.push("COA should have 2 result rows");

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
  await cleanupSession3Data(glycine.id);

  try {
    execSync("npm run verify:session1", { cwd: join(__dirname, ".."), stdio: "pipe" });
  } catch {
    failures.push("verify:session1 regression failed");
  }

  try {
    execSync("npm run verify:session2", { cwd: join(__dirname, ".."), stdio: "pipe" });
  } catch {
    failures.push("verify:session2 regression failed");
  }

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
