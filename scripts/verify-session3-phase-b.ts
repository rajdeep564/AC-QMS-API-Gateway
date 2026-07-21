/**
 * Session 3B Phase B verification — AWS execution, S3(c)-AWS, OOS/expiry ack (Epic 12, US-12-10/11/12, US-7-8, Epic 17).
 */
import "dotenv/config";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import {
  BatchStatus,
  DocStatus,
  DocType,
  Role,
  SectionStatus,
  StandingDocStatus,
} from "@prisma/client";
import { prisma } from "../src/lib/prisma-types";
import { AppError } from "../src/lib/app-error";
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
  approveBatch,
  createBatch,
  submitBatch,
} from "../src/modules/batches/batches.service";
import * as batchesRepo from "../src/modules/batches/batches.repository";
import { CreateSpecBody } from "../src/modules/specs/specs.schema";
import {
  approveSpec,
  createSpec,
  signSpec,
  submitSpec,
} from "../src/modules/specs/specs.service";
import { transition } from "../src/services/workflow-engine";
import { drainDocumentRenderQueues } from "../src/services/render-documents.service";
import { JwtAccessPayload } from "../src/types/auth.types";

import {
  SAMPLE_SPEC_BODY,
  EXPECTED_TEST_COUNT,
  patchSectionInSpec,
  completeSectionTwoPerson,
} from "./lib/aws-section-fixture";
import {
  DEV_PASSWORD,
  ensureQaSignedHarnessSpec,
  ensureVerifierActiveMaster,
  ensureVerifierProduct,
} from "./lib/verifier-harness";

type CheckResult = { name: string; pass: boolean; detail: string };

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

async function deleteSpecFixture(productId: string) {
  await drainDocumentRenderQueues(60_000);
  await prisma.moaDocSection.deleteMany({ where: { moaDoc: { spec: { productId } } } });
  await prisma.moaDoc.deleteMany({ where: { spec: { productId } } });
  await prisma.specTest.deleteMany({ where: { spec: { productId } } });
  await prisma.spec.deleteMany({ where: { productId } });
}

async function deleteBatchFixture(batchId: string) {
  await drainDocumentRenderQueues(60_000);
  await prisma.awsSection.deleteMany({ where: { batchDocument: { batchId } } });
  await prisma.coaResult.deleteMany({ where: { batchDocument: { batchId } } });
  await prisma.batchDocument.deleteMany({ where: { batchId } });
  await prisma.moaDocumentSection.deleteMany({ where: { batchId } });
  await prisma.specDocumentTest.deleteMany({ where: { batchId } });
  await prisma.batch.delete({ where: { id: batchId } });
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

const ROLLBACK_AWS_SPEC_BODY: CreateSpecBody = {
  variant: "GENERAL",
  tests: [
    {
      sortOrder: 1,
      testName: "Description",
      resultType: "QUALITATIVE",
      acceptanceCriteria: "White crystalline powder",
      isOptional: false,
    },
    {
      sortOrder: 2,
      testName: "Assay",
      resultType: "QUANTITATIVE",
      operator: "BETWEEN",
      minValue: 98.5,
      maxValue: 101.5,
      uom: "%",
    },
  ],
  moaSections: [
    { specTestRef: 0, pharmacopoeia: "IP", procedureText: "Visual examination per pharmacopoeia." },
    { specTestRef: 1, pharmacopoeia: "IP", procedureText: "Titrimetric assay per IP monograph." },
  ],
};

async function createActivatedAwsFixture(
  specBody: CreateSpecBody = SAMPLE_SPEC_BODY,
): Promise<{
  batchId: string;
  productId: string;
  awsDocId: string;
  kavyaId: string;
  meeraId: string;
  priyaId: string;
  sanjayId: string;
  sections: { id: string; testName: string; sortOrder: number }[];
}> {
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
    specBody,
  );
  const created = await createBatch(
    verifierProduct.id,
    {
      sourceSpecId: signedSpec.id,
      batchNo: `S3B-${Date.now()}`,
      assignedQcExecId: kavya.id,
      batchSize: "25 kg",
    },
    actor(priya.id, Role.QC_MGR),
  );

  await submitBatch(created.batch.id, actor(priya.id, Role.QC_MGR));
  await approveBatch(created.batch.id, DEV_PASSWORD, actor(sanjay.id, Role.QA_MGR));

  const awsDoc = await prisma.batchDocument.findFirst({
    where: { batchId: created.batch.id, docType: DocType.AWS },
  });
  if (!awsDoc || awsDoc.status !== DocStatus.DRAFT) {
    throw new Error("AWS document must be DRAFT after batch approval");
  }

  const sections = await prisma.awsSection.findMany({
    where: { batchDocumentId: awsDoc.id },
    include: { specDocumentTest: { select: { testName: true, sortOrder: true } } },
    orderBy: { specDocumentTest: { sortOrder: "asc" } },
  });

  return {
    batchId: created.batch.id,
    productId: verifierProduct.id,
    awsDocId: awsDoc.id,
    kavyaId: kavya.id,
    meeraId: meera.id,
    priyaId: priya.id,
    sanjayId: sanjay.id,
    sections: sections.map((s) => ({
      id: s.id,
      testName: s.specDocumentTest.testName,
      sortOrder: s.specDocumentTest.sortOrder,
    })),
  };
}

function txWithForcedAuditFailure<T extends object>(tx: T): T {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === "auditLog") {
        const delegate = Reflect.get(target, prop, receiver) as { create: (...args: unknown[]) => unknown };
        return new Proxy(delegate, {
          get(dTarget, dProp, dReceiver) {
            if (dProp === "create") {
              return async () => {
                throw new Error("FORCED_AWS_AUDIT_FAILURE");
              };
            }
            const val = Reflect.get(dTarget, dProp, dReceiver);
            return typeof val === "function" ? val.bind(dTarget) : val;
          },
        });
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}

async function testBackendRecompute(): Promise<void> {
  let batchId: string | null = null;
  let productId: string | null = null;

  try {
    const fixture = await createActivatedAwsFixture();
    batchId = fixture.batchId;
    productId = fixture.productId;
    const assay = fixture.sections.find((s) => s.testName === "Assay");
    if (!assay) throw new Error("Assay section missing");

    let rejectedClientFields = false;
    try {
      await patchAwsSection(
        assay.id,
        { readings: { variables: { result: 99.5 } } },
        {
          readings: { variables: { result: 99.5 } },
          calculatedResult: 50,
          conclusion: "SATISFACTORY",
        },
        actor(fixture.kavyaId, Role.QC_EXEC),
      );
    } catch (error) {
      rejectedClientFields =
        error instanceof AppError && error.code === "VALIDATION_ERROR";
    }
    assert(rejectedClientFields, "Client-sent calculatedResult/conclusion must be rejected");

    await patchAwsSection(
      assay.id,
      { readings: { variables: { result: 99.5 } } },
      { readings: { variables: { result: 99.5 } } },
      actor(fixture.kavyaId, Role.QC_EXEC),
    );

    const detail = await getAwsSectionDetail(assay.id, actor(fixture.kavyaId, Role.QC_EXEC));
    assert(Number(detail.calculatedResult) === 99.5, "Backend must compute calculatedResult from readings");
    assert(detail.conclusion === "SATISFACTORY", "Backend must derive conclusion from snapshot criteria");

    console.log("  PASS — backend recompute ignores client fields; snapshot formula wins (US-12-10)");
  } finally {
    if (batchId) await deleteBatchFixture(batchId);
    if (productId) await deleteSpecFixture(productId);
  }
}

async function testTwoPersonRule(): Promise<void> {
  let batchId: string | null = null;
  let productId: string | null = null;

  try {
    const fixture = await createActivatedAwsFixture();
    batchId = fixture.batchId;
    productId = fixture.productId;
    const description = fixture.sections.find((s) => s.testName === "Description");
    if (!description) throw new Error("Description section missing");

    await patchAwsSection(
      description.id,
      { readings: { passFail: "PASS" } },
      { readings: { passFail: "PASS" } },
      actor(fixture.kavyaId, Role.QC_EXEC),
    );
    await completeAwsSection(description.id, actor(fixture.kavyaId, Role.QC_EXEC));

    let blocked = false;
    try {
      await checkAwsSection(
        description.id,
        { password: DEV_PASSWORD },
        actor(fixture.kavyaId, Role.QC_EXEC),
      );
    } catch (error) {
      blocked = error instanceof AppError && error.code === "SAME_AS_ANALYST";
    }
    assert(blocked, "Analyst must not check own section");

    console.log("  PASS — two-person rule blocks analyst from checking own section (403)");
  } finally {
    if (batchId) await deleteBatchFixture(batchId);
    if (productId) await deleteSpecFixture(productId);
  }
}

async function testAwsTransitionAuditRollback(): Promise<void> {
  let batchId: string | null = null;
  let productId: string | null = null;

  try {
    const fixture = await createActivatedAwsFixture(ROLLBACK_AWS_SPEC_BODY);
    batchId = fixture.batchId;
    productId = fixture.productId;

    for (const section of fixture.sections) {
      await patchSectionInSpec(section, fixture.kavyaId);
      await completeSectionTwoPerson(section.id, fixture.kavyaId, fixture.meeraId);
    }

    const completion = await batchesRepo.countAwsSectionCompletion(fixture.awsDocId);
    if (!completion.allComplete) {
      const rows = await prisma.awsSection.findMany({
        where: { batchDocumentId: fixture.awsDocId },
        include: { specDocumentTest: { select: { testName: true } } },
      });
      throw new Error(
        `Sections incomplete before SUBMIT: ${completion.incomplete}/${completion.total} (${rows
          .map((r) => `${r.specDocumentTest.testName}:${r.status}`)
          .join(", ")})`,
      );
    }

    let rolledBack = false;
    let submitError: unknown;
    try {
      await prisma.$transaction(async (tx) => {
        await transition({
          entityType: "AWS_DOCUMENT",
          entityId: fixture.awsDocId,
          action: "SUBMIT",
          actor: actor(fixture.kavyaId, Role.QC_EXEC),
          password: DEV_PASSWORD,
          tx: txWithForcedAuditFailure(tx),
        });
      });
    } catch (error) {
      submitError = error;
      if (error instanceof AppError && error.details !== undefined) {
        submitError = `${error.message}: ${JSON.stringify(error.details)}`;
      }
      const message = error instanceof Error ? error.message : String(error);
      const causeMessage =
        error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
      rolledBack =
        message.includes("FORCED_AWS_AUDIT_FAILURE") ||
        causeMessage.includes("FORCED_AWS_AUDIT_FAILURE");
    }

    if (!rolledBack) {
      const awsAfter = await prisma.batchDocument.findUnique({
        where: { id: fixture.awsDocId },
      });
      const detail =
        submitError instanceof Error
          ? submitError.message
          : submitError !== undefined
            ? String(submitError)
            : "no error (SUBMIT committed)";
      throw new Error(
        `Expected forced in-tx audit failure during AWS SUBMIT (${detail}; awsStatus=${awsAfter?.status ?? "missing"})`,
      );
    }

    const awsAfter = await prisma.batchDocument.findUniqueOrThrow({
      where: { id: fixture.awsDocId },
    });
    assert(awsAfter.status === DocStatus.DRAFT, "AWS doc must remain DRAFT when submit rolls back");

    console.log("  PASS — in-tx audit failure rolls back AWS document transition");
  } finally {
    if (batchId) await deleteBatchFixture(batchId);
    if (productId) await deleteSpecFixture(productId);
  }
}

async function main() {
  console.log("Session 3B Phase B verification\n");

  await drainDocumentRenderQueues(60_000);

  const results: CheckResult[] = [];

  results.push(
    await runCheck("AWS activation populates sections (#1)", async () => {
      let batchId: string | null = null;
      let productId: string | null = null;
      try {
        const fixture = await createActivatedAwsFixture();
        batchId = fixture.batchId;
        productId = fixture.productId;

        assert(
          fixture.sections.length === EXPECTED_TEST_COUNT,
          `Expected ${EXPECTED_TEST_COUNT} aws_sections from snapshot`,
        );
        assert(fixture.sections[0]!.sortOrder === 1, "First section sort order must be 1");
        assert(
          fixture.sections[EXPECTED_TEST_COUNT - 1]!.sortOrder === EXPECTED_TEST_COUNT,
          "Last section sort order must match test count",
        );

        const rows = await prisma.awsSection.findMany({
          where: { batchDocumentId: fixture.awsDocId },
          include: { specDocumentTest: true },
        });
        for (const row of rows) {
          assert(row.status === SectionStatus.NOT_STARTED, "Initial status must be NOT_STARTED");
          assert(Boolean(row.specDocumentTestId), "spec_document_test_id FK required");
        }

        const openSrc = readFileSync(
          join(__dirname, "..", "src", "services", "aws-open.service.ts"),
          "utf8",
        );
        assert(!openSrc.includes("deleteAwsSections"), "Must not delete-recreate sections");
        assert(openSrc.includes("createAwsSections"), "Must populate via createMany");

        console.log("  PASS — AWS activation populates sections populate-in-place");
      } finally {
        if (batchId) await deleteBatchFixture(batchId);
        if (productId) await deleteSpecFixture(productId);
      }
    }),
  );

  results.push(
    await runCheck("backend recompute runtime proof (#3)", async () => {
      await testBackendRecompute();
    }),
  );

  results.push(
    await runCheck("OOS ack columns + thresholds (#4-5)", async () => {
      let batchId: string | null = null;
      let productId: string | null = null;
      try {
        const fixture = await createActivatedAwsFixture();
        batchId = fixture.batchId;
        productId = fixture.productId;
        const assay = fixture.sections.find((s) => s.testName === "Assay")!;
        const kavya = actor(fixture.kavyaId, Role.QC_EXEC);

        await patchAwsSection(
          assay.id,
          { readings: { variables: { result: 95.0 } } },
          { readings: { variables: { result: 95.0 } } },
          kavya,
        );
        const preview = await previewAwsSection(
          assay.id,
          { readings: { variables: { result: 95.0 } } },
          kavya,
        );
        assert(preview.isOos, "Assay below NLT must be OOS");

        let shortRejected = false;
        try {
          await acknowledgeOosSection(assay.id, { comment: "too short" }, kavya);
        } catch (error) {
          shortRejected = error instanceof AppError && error.statusCode === 422;
        }
        assert(shortRejected, "OOS ack comment <20 chars must reject with 422");

        const comment = "OOS acknowledged with substantive comment for QA review";
        await acknowledgeOosSection(assay.id, { comment }, kavya);

        const row = await prisma.awsSection.findUniqueOrThrow({ where: { id: assay.id } });
        assert(row.oosAcknowledged === true, "oos_acknowledged must be true");
        assert(row.oosAcknowledgedAt !== null, "oos_acknowledged_at must be set");
        assert(row.oosAckComment === comment.trim(), "oos_ack_comment must persist");

        console.log("  PASS — OOS ack columns set with ≥20-char comment (US-12-12)");
      } finally {
        if (batchId) await deleteBatchFixture(batchId);
        if (productId) await deleteSpecFixture(productId);
      }
    }),
  );

  results.push(
    await runCheck("expiry ack ≥10 chars (#6)", async () => {
      let batchId: string | null = null;
      let productId: string | null = null;
      let instrumentId: string | null = null;
      try {
        const fixture = await createActivatedAwsFixture();
        batchId = fixture.batchId;
        productId = fixture.productId;
        const appearance = fixture.sections[0]!;
        const kavya = actor(fixture.kavyaId, Role.QC_EXEC);

        const instrument = await prisma.instrument.create({
          data: {
            instrumentId: `EXP-${Date.now()}`,
            name: "Expired test instrument",
            useBefore: new Date("2020-01-01"),
          },
        });
        instrumentId = instrument.id;

        await patchAwsSection(
          appearance.id,
          { instrumentId: instrument.id },
          { instrumentId: instrument.id },
          kavya,
        );

        let shortRejected = false;
        try {
          await acknowledgeExpiredSection(
            appearance.id,
            { type: "instrument", comment: "short" },
            kavya,
          );
        } catch (error) {
          shortRejected = error instanceof AppError && error.statusCode === 422;
        }
        assert(shortRejected, "Expiry ack comment <10 chars must reject with 422");

        await acknowledgeExpiredSection(
          appearance.id,
          { type: "instrument", comment: "Valid ten+" },
          kavya,
        );

        console.log("  PASS — expiry ack comment ≥10 chars enforced (US-7-8)");
      } finally {
        if (instrumentId) await prisma.instrument.delete({ where: { id: instrumentId } }).catch(() => {});
        if (batchId) await deleteBatchFixture(batchId);
        if (productId) await deleteSpecFixture(productId);
      }
    }),
  );

  results.push(
    await runCheck("OOS blocks Complete until ack (#7)", async () => {
      let batchId: string | null = null;
      let productId: string | null = null;
      try {
        const fixture = await createActivatedAwsFixture();
        batchId = fixture.batchId;
        productId = fixture.productId;
        const assay = fixture.sections.find((s) => s.testName === "Assay")!;
        const kavya = actor(fixture.kavyaId, Role.QC_EXEC);

        await patchAwsSection(
          assay.id,
          { readings: { variables: { result: 95.0 } } },
          { readings: { variables: { result: 95.0 } } },
          kavya,
        );

        let blocked = false;
        try {
          await completeAwsSection(assay.id, kavya);
        } catch (error) {
          blocked = error instanceof AppError && error.code === "OOS_NOT_ACKNOWLEDGED";
        }
        assert(blocked, "Complete must block until OOS acknowledged");
        console.log("  PASS — OOS blocks Complete until acknowledged");
      } finally {
        if (batchId) await deleteBatchFixture(batchId);
        if (productId) await deleteSpecFixture(productId);
      }
    }),
  );

  results.push(
    await runCheck("expiry blocks Complete until ack (#8)", async () => {
      let batchId: string | null = null;
      let productId: string | null = null;
      let instrumentId: string | null = null;
      try {
        const fixture = await createActivatedAwsFixture();
        batchId = fixture.batchId;
        productId = fixture.productId;
        const appearance = fixture.sections[0]!;
        const kavya = actor(fixture.kavyaId, Role.QC_EXEC);

        const instrument = await prisma.instrument.create({
          data: {
            instrumentId: `EXP2-${Date.now()}`,
            name: "Expired instrument 2",
            useBefore: new Date("2020-01-01"),
          },
        });
        instrumentId = instrument.id;

        await patchAwsSection(
          appearance.id,
          { instrumentId: instrument.id, readings: { passFail: "PASS" } },
          { instrumentId: instrument.id, readings: { passFail: "PASS" } },
          kavya,
        );

        let blocked = false;
        try {
          await completeAwsSection(appearance.id, kavya);
        } catch (error) {
          blocked = error instanceof AppError && error.code === "EXPIRED_NOT_ACKNOWLEDGED";
        }
        assert(blocked, "Complete must block until expiry acknowledged");
        console.log("  PASS — expired instrument blocks Complete until acknowledged");
      } finally {
        if (instrumentId) await prisma.instrument.delete({ where: { id: instrumentId } }).catch(() => {});
        if (batchId) await deleteBatchFixture(batchId);
        if (productId) await deleteSpecFixture(productId);
      }
    }),
  );

  results.push(
    await runCheck("two-person rule runtime (#9)", async () => {
      await testTwoPersonRule();
    }),
  );

  results.push(
    await runCheck("AWS transition audit rollback (#10)", async () => {
      await testAwsTransitionAuditRollback();
    }),
  );

  results.push(
    await runCheck("AWS audit tx-threading static (#11-13)", async () => {
      const awsService = readFileSync(
        join(__dirname, "..", "src", "modules", "aws", "aws.service.ts"),
        "utf8",
      );
      const compliance = readFileSync(
        join(__dirname, "..", "src", "modules", "aws", "aws-compliance.service.ts"),
        "utf8",
      );
      const workflow = readFileSync(
        join(__dirname, "..", "src", "services", "workflow-engine.ts"),
        "utf8",
      );

      assert(awsService.includes("prisma.$transaction"), "patchAwsSection must use $transaction");
      assert(compliance.includes("prisma.$transaction"), "compliance mutations must use $transaction");
      assert(/auditLog\([\s\S]*?\btx\b/.test(awsService), "patch audit in tx");
      assert(/auditSectionAction[\s\S]*?auditLog\([\s\S]*?\btx\b/.test(compliance), "section audit in tx");

      const transitionAwsSrc =
        workflow.match(/async function transitionAwsDocument[\s\S]*?\n\}/)?.[0] ?? "";
      assert(/await auditLog\([\s\S]*?\btx\b/.test(transitionAwsSrc), "AWS transition audit in tx");
      assert(
        !/await prisma\.\$transaction\(runTransition\);\s*\n\s*await auditLog/.test(transitionAwsSrc),
        "AWS transition audit must not run after tx commits",
      );
      assert(
        !/renderDocuments\(/.test(transitionAwsSrc),
        "transitionAwsDocument must not call renderDocuments in-tx",
      );
      assert(
        /scheduleDocumentRender\(\{[\s\S]*?kind:\s*"AWS"/.test(transitionAwsSrc),
        "QA sign must schedule AWS render post-commit",
      );
      const runTransitionBlock =
        transitionAwsSrc.match(/const runTransition = async \(tx: Tx\) => \{[\s\S]*?\n  \};/)?.[0] ??
        "";
      assert(
        !runTransitionBlock.includes("scheduleDocumentRender"),
        "AWS render schedule must not run inside runTransition tx",
      );

      console.log("  PASS — all AWS audit calls tx-threaded; mutations wrapped in $transaction");
    }),
  );

  results.push(
    await runCheck("tsc + migration (#16)", async () => {
      execSync("npx tsc --noEmit", { cwd: join(__dirname, ".."), stdio: "pipe" });
      execSync("npx prisma migrate deploy", { cwd: join(__dirname, ".."), stdio: "pipe" });
      console.log("  PASS — tsc --noEmit and prisma migrate deploy");
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
    console.log("\nOne or more Session 3B checks failed.");
  } else {
    console.log("\nAll Session 3B Phase B checks passed.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
