/**
 * Session 3A Phase B verification — batch hardening, S2, S3(c)-batch, immutability (US-9-13, US-1-14, US-4-5, Epic 17).
 */
import "dotenv/config";
import { execSync } from "child_process";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  BatchStatus,
  DocStatus,
  DocType,
  Role,
  StandingDocStatus,
} from "@prisma/client";
import { prisma } from "../src/lib/prisma-types";
import { AppError } from "../src/lib/app-error";
import { assertBatchLocked, assertBatchStatusMutationAllowed } from "../src/modules/batches/batches-guards";
import {
  approveBatch,
  createBatch,
  getBatchById,
  submitBatch,
} from "../src/modules/batches/batches.service";
import { CreateSpecBody } from "../src/modules/specs/specs.schema";
import {
  approveSpec,
  createSpec,
  signSpec,
  submitSpec,
} from "../src/modules/specs/specs.service";
import { transition } from "../src/services/workflow-engine";
import { JwtAccessPayload } from "../src/types/auth.types";

const DEV_PASSWORD = "Acqms@2026";

type CheckResult = { name: string; pass: boolean; detail: string };

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
      formulaVariables: { variables: [{ name: "result" }] },
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

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function runCheck(name: string, fn: () => void | Promise<void>): Promise<CheckResult> {
  try {
    await fn();
    return { name, pass: true, detail: "PASS" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { name, pass: false, detail };
  }
}

async function getUser(username: string) {
  const user = await prisma.user.findFirst({ where: { username, deletedAt: null } });
  if (!user) throw new Error(`User ${username} must be seeded`);
  return user;
}

async function deleteBatchFixture(batchId: string): Promise<void> {
  await prisma.awsSection.deleteMany({ where: { batchDocument: { batchId } } });
  await prisma.coaResult.deleteMany({ where: { batchDocument: { batchId } } });
  await prisma.batchDocument.deleteMany({ where: { batchId } });
  await prisma.moaDocumentSection.deleteMany({ where: { batchId } });
  await prisma.specDocumentTest.deleteMany({ where: { batchId } });
  await prisma.batch.delete({ where: { id: batchId } });
}

async function deleteSpecFixture(productId: string): Promise<void> {
  await prisma.moaDocSection.deleteMany({ where: { moaDoc: { spec: { productId } } } });
  await prisma.moaDoc.deleteMany({ where: { spec: { productId } } });
  await prisma.specTest.deleteMany({ where: { spec: { productId } } });
  await prisma.spec.deleteMany({ where: { productId } });
}

async function ensureQaSignedSpec(
  productId: string,
  kavyaId: string,
  priyaId: string,
  sanjayId: string,
) {
  await deleteSpecFixture(productId);
  const created = await createSpec(productId, SAMPLE_SPEC_BODY, actor(kavyaId, Role.QC_EXEC));
  await submitSpec(created.id, actor(kavyaId, Role.QC_EXEC));
  await approveSpec(created.id, DEV_PASSWORD, actor(priyaId, Role.QC_MGR));
  await signSpec(created.id, DEV_PASSWORD, actor(sanjayId, Role.QA_MGR));
  const signed = await prisma.spec.findFirst({
    where: { productId, status: StandingDocStatus.QA_SIGNED },
    orderBy: { revisionNo: "desc" },
  });
  if (!signed) throw new Error("Failed to obtain QA_SIGNED spec fixture");
  return signed;
}

async function createSubmittedBatchFixture(): Promise<{
  batchId: string;
  productId: string;
  sanjayId: string;
  priyaId: string;
}> {
  const glycine = await prisma.product.findFirst({ where: { name: "Glycine" } });
  if (!glycine) throw new Error("Glycine product must be seeded");

  const kavya = await getUser("kavya.patel");
  const priya = await getUser("priya.mehta");
  const sanjay = await getUser("sanjay.reddy");

  const signedSpec = await ensureQaSignedSpec(glycine.id, kavya.id, priya.id, sanjay.id);
  const batchNo = `S3A-${Date.now()}`;

  const created = await createBatch(
    glycine.id,
    {
      sourceSpecId: signedSpec.id,
      batchNo,
      assignedQcExecId: kavya.id,
      batchSize: "50 kg",
    },
    actor(priya.id, Role.QC_MGR),
  );

  await submitBatch(created.batch.id, actor(priya.id, Role.QC_MGR));

  return {
    batchId: created.batch.id,
    productId: glycine.id,
    sanjayId: sanjay.id,
    priyaId: priya.id,
  };
}

/** Fail-closed in-tx audit write — same hook point as createAuditLog(input, tx) → tx.auditLog.create. */
function txWithForcedAuditFailure<T extends object>(tx: T): T {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === "auditLog") {
        const auditLog = Reflect.get(target, prop, receiver);
        return {
          ...auditLog,
          create: async () => {
            throw new Error("FORCED_BATCH_AUDIT_FAILURE");
          },
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
}

async function testBatchApproveAuditRollback(): Promise<void> {
  let batchId: string | null = null;
  let productId: string | null = null;

  try {
    const fixture = await createSubmittedBatchFixture();
    batchId = fixture.batchId;
    productId = fixture.productId;

    let rolledBack = false;
    try {
      await prisma.$transaction(async (tx) => {
        await transition({
          entityType: "BATCH",
          entityId: batchId!,
          action: "APPROVE",
          actor: actor(fixture.sanjayId, Role.QA_MGR),
          password: DEV_PASSWORD,
          tx: txWithForcedAuditFailure(tx),
        });
      });
    } catch (error) {
      rolledBack =
        error instanceof Error && error.message === "FORCED_BATCH_AUDIT_FAILURE";
    }

    assert(rolledBack, "Expected forced in-tx audit failure during batch APPROVE");

    const after = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
    assert(
      after.status === BatchStatus.PENDING_APPROVAL,
      "Batch status must roll back when in-tx audit fails",
    );

    const awsDoc = await prisma.batchDocument.findFirst({
      where: { batchId, docType: DocType.AWS },
    });
    assert(awsDoc?.status === DocStatus.PENDING, "AWS must remain PENDING when approve rolls back");

    console.log("  PASS — in-tx audit failure rolls back batch APPROVE transition");
  } finally {
    if (batchId) await deleteBatchFixture(batchId);
    if (productId) await deleteSpecFixture(productId);
  }
}

async function testSnapshotImmutability(): Promise<void> {
  let batchId: string | null = null;
  let productId: string | null = null;
  let specId: string | null = null;

  try {
    const glycine = await prisma.product.findFirst({ where: { name: "Glycine" } });
    if (!glycine) throw new Error("Glycine product must be seeded");

    const kavya = await getUser("kavya.patel");
    const priya = await getUser("priya.mehta");
    const sanjay = await getUser("sanjay.reddy");

    productId = glycine.id;
    const signedSpec = await ensureQaSignedSpec(glycine.id, kavya.id, priya.id, sanjay.id);
    specId = signedSpec.id;

    const created = await createBatch(
      glycine.id,
      {
        sourceSpecId: signedSpec.id,
        batchNo: `IMMUT-${Date.now()}`,
        assignedQcExecId: kavya.id,
      },
      actor(priya.id, Role.QC_MGR),
    );
    batchId = created.batch.id;

    const frozenBefore = created.batch.specDocTests.map((t) => t.testName).sort();

    await prisma.specTest.updateMany({
      where: { specId },
      data: { testName: "MUTATED-R01-TEST" },
    });

    const batchAfter = await getBatchById(batchId, actor(priya.id, Role.QC_MGR));
    const frozenAfter = batchAfter.specDocTests.map((t) => t.testName).sort();

    assert(
      JSON.stringify(frozenBefore) === JSON.stringify(frozenAfter),
      "Batch spec_document_tests must remain frozen after standing SPEC mutation (US-4-5 Scenario 2)",
    );

    console.log(
      "  PASS — batch snapshot unchanged after standing SPEC revision (US-4-5 Scenario 2)",
    );
  } finally {
    if (batchId) await deleteBatchFixture(batchId);
    if (productId) await deleteSpecFixture(productId);
  }
}

function grepSnapshotMutationPaths(): string[] {
  const srcRoot = join(__dirname, "..", "src");
  const hits: string[] = [];
  const patterns = [
    /specDocumentTest\.update/g,
    /specDocumentTest\.delete/g,
    /moaDocumentSection\.update/g,
    /moaDocumentSection\.delete/g,
  ];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!full.endsWith(".ts")) continue;
      if (full.includes(`${srcRoot}\\fixtures`) || full.includes(`${srcRoot}/fixtures`)) continue;
      const content = readFileSync(full, "utf8");
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          hits.push(`${full.replace(srcRoot + "\\", "").replace(srcRoot + "/", "")}`);
        }
        pattern.lastIndex = 0;
      }
    }
  }

  walk(srcRoot);
  return [...new Set(hits)];
}

async function main() {
  console.log("Session 3A Phase B verification\n");

  const results: CheckResult[] = [];

  results.push(
    await runCheck("audit rollback proof on batch APPROVE (#5)", async () => {
      await testBatchApproveAuditRollback();
    }),
  );

  results.push(
    await runCheck("S2 self-approval blocked (#6)", async () => {
      let batchId: string | null = null;
      let productId: string | null = null;
      try {
        const fixture = await createSubmittedBatchFixture();
        batchId = fixture.batchId;
        productId = fixture.productId;

        await prisma.batch.update({
          where: { id: batchId },
          data: { createdById: fixture.sanjayId },
        });

        let threw = false;
        try {
          await approveBatch(batchId, DEV_PASSWORD, actor(fixture.sanjayId, Role.QA_MGR));
        } catch (error) {
          threw = error instanceof AppError && error.code === "SELF_APPROVAL";
        }
        assert(threw, "QA_MGR who created the batch must receive 403 self-approval");
        console.log("  PASS — batch self-approval blocked (S2)");
      } finally {
        if (batchId) await deleteBatchFixture(batchId);
        if (productId) await deleteSpecFixture(productId);
      }
    }),
  );

  results.push(
    await runCheck("fresh password on approve (#7)", async () => {
      let batchId: string | null = null;
      let productId: string | null = null;
      try {
        const fixture = await createSubmittedBatchFixture();
        batchId = fixture.batchId;
        productId = fixture.productId;

        let wrongPassword = false;
        try {
          await approveBatch(batchId, "not-the-password", actor(fixture.sanjayId, Role.QA_MGR));
        } catch {
          wrongPassword = true;
        }
        assert(wrongPassword, "Wrong password must reject batch approve");

        const stillPending = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
        assert(
          stillPending.status === BatchStatus.PENDING_APPROVAL,
          "Batch must stay PENDING_APPROVAL after wrong password",
        );

        await approveBatch(batchId, DEV_PASSWORD, actor(fixture.sanjayId, Role.QA_MGR));
        console.log("  PASS — fresh password required on batch approve (US-1-14)");
      } finally {
        if (batchId) await deleteBatchFixture(batchId);
        if (productId) await deleteSpecFixture(productId);
      }
    }),
  );

  results.push(
    await runCheck("AWS PENDING→DRAFT on approve (#8)", async () => {
      let batchId: string | null = null;
      let productId: string | null = null;
      try {
        const fixture = await createSubmittedBatchFixture();
        batchId = fixture.batchId;
        productId = fixture.productId;

        const before = await prisma.batchDocument.findFirst({
          where: { batchId, docType: DocType.AWS },
        });
        assert(before?.status === DocStatus.PENDING, "AWS must start PENDING at batch create");

        await approveBatch(batchId, DEV_PASSWORD, actor(fixture.sanjayId, Role.QA_MGR));

        const after = await prisma.batchDocument.findFirst({
          where: { batchId, docType: DocType.AWS },
        });
        assert(after?.status === DocStatus.DRAFT, "AWS must flip to DRAFT on batch APPROVED");
        console.log("  PASS — AWS batch_document activated PENDING→DRAFT on approve");
      } finally {
        if (batchId) await deleteBatchFixture(batchId);
        if (productId) await deleteSpecFixture(productId);
      }
    }),
  );

  results.push(
    await runCheck("aws_sections populated on activation (#9)", async () => {
      const awsOpenSrc = readFileSync(
        join(__dirname, "..", "src", "services", "aws-open.service.ts"),
        "utf8",
      );
      assert(awsOpenSrc.includes("createAwsSections"), "aws-open must populate sections");
      assert(!awsOpenSrc.includes("TODO(Session 3B"), "3B section population must be implemented");
      assert(!awsOpenSrc.includes("deleteAwsSections"), "must not delete-recreate sections");
      console.log("  PASS — aws_sections populated on AWS activation (Session 3B)");
    }),
  );

  results.push(
    await runCheck("batch lock guards wired (#10)", async () => {
      let batchId: string | null = null;
      let productId: string | null = null;
      try {
        const fixture = await createSubmittedBatchFixture();
        batchId = fixture.batchId;
        productId = fixture.productId;

        await approveBatch(batchId, DEV_PASSWORD, actor(fixture.sanjayId, Role.QA_MGR));

        let locked = false;
        try {
          await assertBatchLocked(batchId);
        } catch (error) {
          locked = error instanceof AppError && error.statusCode === 409;
        }
        assert(locked, "APPROVED batch must reject mutation via assertBatchLocked");

        let statusBlocked = false;
        try {
          await assertBatchStatusMutationAllowed(batchId, BatchStatus.DRAFT);
        } catch (error) {
          statusBlocked = error instanceof AppError && error.statusCode === 409;
        }
        assert(statusBlocked, "APPROVED batch must block status rollback to DRAFT");

        console.log("  PASS — batch lock guards reject post-approval mutation");
      } finally {
        if (batchId) await deleteBatchFixture(batchId);
        if (productId) await deleteSpecFixture(productId);
      }
    }),
  );

  results.push(
    await runCheck("snapshot immutability proof (#11)", async () => {
      await testSnapshotImmutability();
    }),
  );

  results.push(
    await runCheck("no snapshot update/delete in production src (#12)", async () => {
      const hits = grepSnapshotMutationPaths();
      assert(hits.length === 0, `Found snapshot mutation paths: ${hits.join(", ")}`);
      console.log("  PASS — no spec_document_tests/moa_document_sections update/delete in src/");
    }),
  );

  results.push(
    await runCheck("batch audit tx-threading (static #1-4)", async () => {
      const controller = readFileSync(
        join(__dirname, "..", "src", "modules", "batches", "batches.controller.ts"),
        "utf8",
      );
      const service = readFileSync(
        join(__dirname, "..", "src", "modules", "batches", "batches.service.ts"),
        "utf8",
      );
      const workflow = readFileSync(
        join(__dirname, "..", "src", "services", "workflow-engine.ts"),
        "utf8",
      );
      const awsOpen = readFileSync(
        join(__dirname, "..", "src", "services", "aws-open.service.ts"),
        "utf8",
      );

      assert(!controller.includes("auditLog"), "Controller must not write batch audit");
      assert(
        service.includes("await auditLog(") && /auditLog\([\s\S]*?\btx\b/.test(service),
        "CREATE audit in tx",
      );
      const transitionBatchSrc =
        workflow.match(/async function transitionBatch[\s\S]*?\n\}/)?.[0] ?? "";
      assert(
        /await auditLog\([\s\S]*?\btx\b/.test(transitionBatchSrc),
        "Batch transition audit must be inside tx",
      );
      assert(
        !/await prisma\.\$transaction\(runTransition\);\s*\n\s*await auditLog/.test(
          transitionBatchSrc,
        ),
        "Batch transition audit must not run after tx commits",
      );
      assert(
        awsOpen.includes("await auditLog(") && /auditLog\([\s\S]*?\btx\b/.test(awsOpen),
        "AWS-open audit in tx",
      );
      console.log("  PASS — batch audit calls are tx-threaded (CREATE, transition, AWS-open)");
    }),
  );

  results.push(
    await runCheck("tsc --noEmit (#14)", async () => {
      execSync("npx tsc --noEmit", { cwd: join(__dirname, ".."), stdio: "pipe" });
      console.log("  PASS — tsc --noEmit");
    }),
  );

  console.log("\n--- Summary ---");
  let allPass = true;
  for (const r of results) {
    const status = r.pass ? "PASS" : "FAIL";
    if (!r.pass) allPass = false;
    console.log(`  ${status} — ${r.name}${r.pass ? "" : `: ${r.detail}`}`);
  }

  if (!allPass) {
    process.exitCode = 1;
    console.log("\nOne or more Session 3A checks failed.");
  } else {
    console.log("\nAll Session 3A Phase B checks passed.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
