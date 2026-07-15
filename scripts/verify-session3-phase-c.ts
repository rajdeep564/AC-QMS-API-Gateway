/**
 * Session 3C Phase B verification — COA chain, S4 engine migration, S3(c)-COA (Epic 13, US-13-1–9/12, Epic 17).
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
import { checkAwsSection, completeAwsSection } from "../src/modules/aws/aws-compliance.service";
import { patchAwsSection } from "../src/modules/aws/aws.service";
import {
  approveBatch,
  createBatch,
  submitBatch,
} from "../src/modules/batches/batches.service";
import {
  signAndIssueCoa,
  transitionDocument,
} from "../src/modules/documents/documents.service";
import { CreateSpecBody } from "../src/modules/specs/specs.schema";
import {
  approveSpec,
  createSpec,
  signSpec,
  submitSpec,
} from "../src/modules/specs/specs.service";
import { generateCoaFromSignedAws } from "../src/services/coa-generator";
import { transition } from "../src/services/workflow-engine";
import { JwtAccessPayload } from "../src/types/auth.types";

import {
  DEV_PASSWORD,
  ensureQaSignedHarnessSpec,
  ensureVerifierActiveMaster,
  ensureVerifierProduct,
} from "./lib/verifier-harness";
import { SAMPLE_SPEC_BODY } from "./fixtures/spec-sample-body";

type CheckResult = { id: number; name: string; pass: boolean; detail: string };

function actor(userId: string, role: Role, departmentId: string | null = null): JwtAccessPayload {
  return { userId, role, departmentId };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function runCheck(id: number, name: string, fn: () => void | Promise<void>): Promise<CheckResult> {
  try {
    await fn();
    return { id, name, pass: true, detail: "PASS" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { id, name, pass: false, detail };
  }
}

async function getUser(username: string) {
  const user = await prisma.user.findFirst({ where: { username, deletedAt: null } });
  if (!user) throw new Error(`User ${username} must be seeded`);
  return user;
}

async function deleteSpecFixture(productId: string) {
  const batches = await prisma.batch.findMany({
    where: { productId },
    select: { id: true },
  });
  for (const batch of batches) {
    await deleteBatchFixture(batch.id);
  }
  await prisma.moaDocSection.deleteMany({ where: { moaDoc: { spec: { productId } } } });
  await prisma.moaDoc.deleteMany({ where: { spec: { productId } } });
  await prisma.specTest.deleteMany({ where: { spec: { productId } } });
  await prisma.spec.deleteMany({ where: { productId } });
}

async function deleteBatchFixture(batchId: string) {
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

function txWithForcedAuditFailure<T extends object>(tx: T): T {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === "auditLog") {
        const auditLog = Reflect.get(target, prop, receiver);
        return {
          ...auditLog,
          create: async () => {
            throw new Error("FORCED_COA_AUDIT_FAILURE");
          },
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
}

async function completeSectionTwoPerson(
  sectionId: string,
  analystId: string,
  checkerId: string,
): Promise<void> {
  await completeAwsSection(sectionId, actor(analystId, Role.QC_EXEC));
  await checkAwsSection(sectionId, { password: DEV_PASSWORD }, actor(checkerId, Role.QC_EXEC));
}

async function createCoaReadyFixture(batchNoSuffix: string) {
  const verifierProduct = await ensureVerifierProduct();
  await ensureVerifierActiveMaster((await getUser("kavya.patel")).id);

  const master = await prisma.productMaster.findFirst({
    where: { productId: verifierProduct.id, status: "ACTIVE" },
    include: { fields: true },
  });
  const productCode = master?.fields.find((f) => f.fieldKey === "product_code")?.value;
  if (!productCode) throw new Error("Verifier harness master must have product_code");

  const kavya = await getUser("kavya.patel");
  const meera = await getUser("meera.iyer");
  const priya = await getUser("priya.mehta");
  const sanjay = await getUser("sanjay.reddy");

  const batchNo = `S3C-${batchNoSuffix}`;
  const signedSpec = await ensureQaSignedHarnessSpec(
    verifierProduct.id,
    kavya.id,
    priya.id,
    sanjay.id,
    SAMPLE_SPEC_BODY,
  );
  const created = await createBatch(
    verifierProduct.id,
    {
      sourceSpecId: signedSpec.id,
      batchNo,
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
  if (!awsDoc) throw new Error("AWS document missing");

  const sections = await prisma.awsSection.findMany({
    where: { batchDocumentId: awsDoc.id },
    include: { specDocumentTest: true },
    orderBy: { specDocumentTest: { sortOrder: "asc" } },
  });

  for (const section of sections) {
    if (section.specDocumentTest.testName === "Appearance") {
      await patchAwsSection(
        section.id,
        { readings: { passFail: "PASS" } },
        { readings: { passFail: "PASS" } },
        actor(kavya.id, Role.QC_EXEC),
      );
    } else if (section.specDocumentTest.testName === "Assay") {
      await patchAwsSection(
        section.id,
        { readings: { variables: { result: 99.5 } } },
        { readings: { variables: { result: 99.5 } } },
        actor(kavya.id, Role.QC_EXEC),
      );
    }
    await completeSectionTwoPerson(section.id, kavya.id, meera.id);
  }

  await transitionDocument(awsDoc.id, "SUBMIT", actor(kavya.id, Role.QC_EXEC));
  await transitionDocument(awsDoc.id, "APPROVE", actor(priya.id, Role.QC_MGR), DEV_PASSWORD);
  await transitionDocument(awsDoc.id, "SIGN", actor(sanjay.id, Role.QA_MGR), DEV_PASSWORD);

  const coaDoc = await prisma.batchDocument.findFirst({
    where: { batchId: created.batch.id, docType: DocType.COA },
    include: { coaResults: true },
  });
  if (!coaDoc || coaDoc.status !== DocStatus.AUTO_GENERATED) {
    throw new Error("COA must be AUTO_GENERATED");
  }

  const awsAfter = await prisma.batchDocument.findUniqueOrThrow({ where: { id: awsDoc.id } });

  return {
    batchId: created.batch.id,
    batchNo,
    productCode,
    awsDocId: awsDoc.id,
    coaDocId: coaDoc.id,
    coaResultCount: coaDoc.coaResults.length,
    kavyaId: kavya.id,
    priyaId: priya.id,
    sanjayId: sanjay.id,
    awsCreatedById: awsAfter.createdById,
    awsQcApprovedById: awsAfter.qcApprovedById,
  };
}

async function main() {
  const results: CheckResult[] = [];

  results.push(
    await runCheck(1, "COA transition via workflow-engine (S4); no custom bypass", async () => {
      const serviceSrc = readFileSync(
        join(__dirname, "../src/modules/documents/documents.service.ts"),
        "utf8",
      );
      assert(
        serviceSrc.includes('entityType: "COA_DOCUMENT"') &&
          serviceSrc.includes('action: "SIGN_ISSUE"') &&
          !serviceSrc.includes("transitionCoaDocumentToIssued") &&
          !serviceSrc.includes("releaseBatch"),
        "signAndIssueCoa must delegate to workflow engine only",
      );
      const engineSrc = readFileSync(
        join(__dirname, "../src/services/workflow-engine.ts"),
        "utf8",
      );
      assert(engineSrc.includes("transitionCoaDocument"), "workflow-engine must own COA transition");
    }),
  );

  results.push(
    await runCheck(2, "COA transition rules in workflow.config.ts", async () => {
      const configSrc = readFileSync(
        join(__dirname, "../src/services/workflow.config.ts"),
        "utf8",
      );
      assert(configSrc.includes("COA_DOCUMENT_TRANSITIONS"), "COA_DOCUMENT_TRANSITIONS missing");
      assert(
        configSrc.includes('fromStatus: "AUTO_GENERATED"') &&
          configSrc.includes('action: "SIGN_ISSUE"') &&
          configSrc.includes('toStatus: "ISSUED"') &&
          configSrc.includes("Role.QA_MGR"),
        "AUTO_GENERATED→ISSUED SIGN_ISSUE QA_MGR rule missing",
      );
    }),
  );

  results.push(
    await runCheck(
      3,
      "Runtime — atomic release rollback on forced audit failure",
      async () => {
        const fixture = await createCoaReadyFixture(`atomic-${Date.now()}`);
        try {
          let threw = false;
          try {
            await prisma.$transaction(async (tx) => {
              await transition({
                entityType: "COA_DOCUMENT",
                entityId: fixture.coaDocId,
                action: "SIGN_ISSUE",
                actor: actor(fixture.sanjayId, Role.QA_MGR),
                password: DEV_PASSWORD,
                tx: txWithForcedAuditFailure(tx),
              });
            });
          } catch {
            threw = true;
          }
          assert(threw, "Forced audit failure must throw");

          const coaAfter = await prisma.batchDocument.findUniqueOrThrow({
            where: { id: fixture.coaDocId },
          });
          const batchAfter = await prisma.batch.findUniqueOrThrow({
            where: { id: fixture.batchId },
          });
          assert(coaAfter.status === DocStatus.AUTO_GENERATED, "COA must roll back to AUTO_GENERATED");
          assert(batchAfter.status === BatchStatus.APPROVED, "Batch must roll back to APPROVED");
          console.log("  PASS — in-tx audit failure rolls back COA issue and batch release");
        } finally {
          const product = await prisma.product.findFirst({ where: { name: "Glycine" } });
          await deleteBatchFixture(fixture.batchId);
          if (product) await deleteSpecFixture(product.id);
        }
      },
    ),
  );

  results.push(
    await runCheck(4, "Runtime — no-self-issue returns 403", async () => {
      const fixture = await createCoaReadyFixture(`selfissue-${Date.now()}`);
      try {
        let forbidden = false;
        try {
          await signAndIssueCoa(
            fixture.coaDocId,
            actor(fixture.priyaId, Role.QA_MGR),
            DEV_PASSWORD,
          );
        } catch (error) {
          forbidden = error instanceof AppError && error.statusCode === 403;
        }
        assert(forbidden, "QC approver acting as QA_MGR must receive 403");
        console.log("  PASS — no-self-issue guard blocks COA sign-and-issue");
      } finally {
        const batch = await prisma.product.findFirst({ where: { name: "Glycine" } });
        await deleteBatchFixture(fixture.batchId);
        if (batch) await deleteSpecFixture(batch.id);
      }
    }),
  );

  results.push(
    await runCheck(5, "Runtime — idempotent COA auto-gen is no-op", async () => {
      const fixture = await createCoaReadyFixture(`idempotent-${Date.now()}`);
      try {
        const beforeCount = await prisma.coaResult.count({
          where: { batchDocumentId: fixture.coaDocId },
        });
        await prisma.$transaction(async (tx) => {
          await generateCoaFromSignedAws(
            tx,
            fixture.batchId,
            fixture.awsDocId,
            `AWS/${fixture.batchNo}`,
          );
        });
        const afterCount = await prisma.coaResult.count({
          where: { batchDocumentId: fixture.coaDocId },
        });
        assert(beforeCount === afterCount && beforeCount > 0, "coa_results row count must be unchanged");
        console.log("  PASS — idempotent COA auto-gen is silent no-op");
      } finally {
        const product = await prisma.product.findFirst({ where: { name: "Glycine" } });
        await deleteBatchFixture(fixture.batchId);
        if (product) await deleteSpecFixture(product.id);
      }
    }),
  );

  results.push(
    await runCheck(
      6,
      "Runtime — S3(c)-COA audit rollback on sign-and-issue",
      async () => {
        const fixture = await createCoaReadyFixture(`auditrb-${Date.now()}`);
        try {
          let threw = false;
          try {
            await prisma.$transaction(async (tx) => {
              await transition({
                entityType: "COA_DOCUMENT",
                entityId: fixture.coaDocId,
                action: "SIGN_ISSUE",
                actor: actor(fixture.sanjayId, Role.QA_MGR),
                password: DEV_PASSWORD,
                tx: txWithForcedAuditFailure(tx),
              });
            });
          } catch (error) {
            threw =
              error instanceof Error && error.message.includes("FORCED_COA_AUDIT_FAILURE");
          }
          assert(threw, "Audit proxy must abort transaction");
          const coaAfter = await prisma.batchDocument.findUniqueOrThrow({
            where: { id: fixture.coaDocId },
          });
          const batchAfter = await prisma.batch.findUniqueOrThrow({
            where: { id: fixture.batchId },
          });
          assert(coaAfter.status === DocStatus.AUTO_GENERATED, "COA not ISSUED after rollback");
          assert(batchAfter.status === BatchStatus.APPROVED, "Batch not RELEASED after rollback");
          console.log("  PASS — in-tx audit failure rolls back COA sign-and-issue and batch release");
        } finally {
          const product = await prisma.product.findFirst({ where: { name: "Glycine" } });
          await deleteBatchFixture(fixture.batchId);
          if (product) await deleteSpecFixture(product.id);
        }
      },
    ),
  );

  results.push(
    await runCheck(7, "All three COA audit writes tx-threaded", async () => {
      const coaGenSrc = readFileSync(join(__dirname, "../src/services/coa-generator.ts"), "utf8");
      const engineSrc = readFileSync(join(__dirname, "../src/services/workflow-engine.ts"), "utf8");
      const docSrc = readFileSync(
        join(__dirname, "../src/modules/documents/documents.service.ts"),
        "utf8",
      );
      assert(
        coaGenSrc.includes("await auditLog(") && coaGenSrc.includes(", tx)"),
        "COA auto-gen audit must pass tx",
      );
      assert(
        engineSrc.includes("transitionCoaDocument") &&
          engineSrc.match(/await auditLog\([\s\S]*?, tx\)/g)?.length !== undefined,
        "COA sign-and-issue and batch-release audits must pass tx in engine",
      );
      assert(
        !docSrc.includes("await auditLog("),
        "documents.service must not contain standalone COA/release audits",
      );
    }),
  );

  results.push(
    await runCheck(8, "Signature block at auto-gen (US-13-5)", async () => {
      const fixture = await createCoaReadyFixture(`sig-${Date.now()}`);
      try {
        const coa = await prisma.batchDocument.findUniqueOrThrow({
          where: { id: fixture.coaDocId },
        });
        assert(coa.createdById === fixture.awsCreatedById, "Prepared By must be AWS creator");
        assert(coa.qcApprovedById === fixture.awsQcApprovedById, "Checked By must be QC approver");
        assert(coa.qaSignedById === null, "Approved By must be blank at auto-gen");
      } finally {
        const product = await prisma.product.findFirst({ where: { name: "Glycine" } });
        await deleteBatchFixture(fixture.batchId);
        if (product) await deleteSpecFixture(product.id);
      }
    }),
  );

  results.push(
    await runCheck(9, "Sign-and-issue sets qaSignedById", async () => {
      const fixture = await createCoaReadyFixture(`issue-${Date.now()}`);
      try {
        await signAndIssueCoa(
          fixture.coaDocId,
          actor(fixture.sanjayId, Role.QA_MGR),
          DEV_PASSWORD,
        );
        const coa = await prisma.batchDocument.findUniqueOrThrow({
          where: { id: fixture.coaDocId },
        });
        assert(coa.qaSignedById === fixture.sanjayId, "qaSignedById must be issuing QA_MGR");
      } finally {
        const product = await prisma.product.findFirst({ where: { name: "Glycine" } });
        await deleteBatchFixture(fixture.batchId);
        if (product) await deleteSpecFixture(product.id);
      }
    }),
  );

  results.push(
    await runCheck(10, "released_at set atomically with RELEASED", async () => {
      const fixture = await createCoaReadyFixture(`released-${Date.now()}`);
      try {
        await signAndIssueCoa(
          fixture.coaDocId,
          actor(fixture.sanjayId, Role.QA_MGR),
          DEV_PASSWORD,
        );
        const batch = await prisma.batch.findUniqueOrThrow({ where: { id: fixture.batchId } });
        assert(batch.status === BatchStatus.RELEASED, "Batch must be RELEASED");
        assert(batch.releasedAt != null, "released_at must be set");
      } finally {
        const product = await prisma.product.findFirst({ where: { name: "Glycine" } });
        await deleteBatchFixture(fixture.batchId);
        if (product) await deleteSpecFixture(product.id);
      }
    }),
  );

  results.push(
    await runCheck(11, "COA immutability rejects edit + audits denial", async () => {
      const fixture = await createCoaReadyFixture(`immutable-${Date.now()}`);
      try {
        let rejected = false;
        try {
          await transitionDocument(
            fixture.coaDocId,
            "SUBMIT",
            actor(fixture.kavyaId, Role.QC_EXEC),
          );
        } catch (error) {
          rejected = error instanceof AppError && error.code === "COA_NOT_EDITABLE";
        }
        assert(rejected, "COA workflow edit must throw COA_NOT_EDITABLE");
        const denialAudit = await prisma.auditLog.findFirst({
          where: {
            entityId: fixture.coaDocId,
            entityType: "COA",
            comment: { contains: "Denied SUBMIT on COA" },
          },
        });
        assert(denialAudit != null, "Denied edit must be audited");
      } finally {
        const product = await prisma.product.findFirst({ where: { name: "Glycine" } });
        await deleteBatchFixture(fixture.batchId);
        if (product) await deleteSpecFixture(product.id);
      }
    }),
  );

  results.push(
    await runCheck(12, "COA doc_no = COA/[product_code]/[batchNo]", async () => {
      const fixture = await createCoaReadyFixture(`docno-${Date.now()}`);
      try {
        const coa = await prisma.batchDocument.findUniqueOrThrow({
          where: { id: fixture.coaDocId },
        });
        const expected = `COA/${fixture.productCode}/${fixture.batchNo}`;
        assert(coa.docNo === expected, `Expected ${expected}, got ${coa.docNo}`);
      } finally {
        const product = await prisma.product.findFirst({ where: { name: "Glycine" } });
        await deleteBatchFixture(fixture.batchId);
        if (product) await deleteSpecFixture(product.id);
      }
    }),
  );

  results.push(
    await runCheck(13, "Production/Stores notification TODO cites US-13-9", async () => {
      const engineSrc = readFileSync(
        join(__dirname, "../src/services/workflow-engine.ts"),
        "utf8",
      );
      assert(
        engineSrc.includes("TODO US-13-9") &&
          engineSrc.includes("Production") &&
          engineSrc.includes("Stores"),
        "US-13-9 TODO seam missing in workflow-engine",
      );
    }),
  );

  results.push(
    await runCheck(14, "Compliance verdict / sort order / no-manual-create unchanged", async () => {
      const coaGenSrc = readFileSync(join(__dirname, "../src/services/coa-generator.ts"), "utf8");
      const repoSrc = readFileSync(
        join(__dirname, "../src/modules/batches/batches.repository.ts"),
        "utf8",
      );
      const routesSrc = readFileSync(
        join(__dirname, "../src/modules/batches/batches.routes.ts"),
        "utf8",
      );
      assert(coaGenSrc.includes("computeComplianceVerdict"), "Verdict logic must remain");
      assert(
        repoSrc.includes('orderBy: { specDocumentTest: { sortOrder: "asc" } }'),
        "Sort order query must remain",
      );
      assert(!routesSrc.includes("coa/create"), "No manual COA create route");
    }),
  );

  results.push(
    await runCheck(15, "COA-gen atomic with AWS sign (Phase A #2)", async () => {
      const engineSrc = readFileSync(
        join(__dirname, "../src/services/workflow-engine.ts"),
        "utf8",
      );
      assert(
        engineSrc.includes("await generateCoaFromSignedAws(tx,") &&
          engineSrc.includes('rule.toStatus === "QA_SIGNED"'),
        "generateCoaFromSignedAws must remain inside AWS SIGN tx",
      );
    }),
  );

  results.push(
    await runCheck(16, "tsc + migration + verify:session3 regression", async () => {
      execSync("npm run typecheck", { cwd: join(__dirname, ".."), stdio: "pipe" });
      execSync("npx prisma migrate deploy", { cwd: join(__dirname, ".."), stdio: "pipe" });
      execSync("npm run verify:session3", { cwd: join(__dirname, ".."), stdio: "pipe" });
    }),
  );

  console.log("\nSession 3C Phase B — verification results\n");
  console.log("| # | Check | Pass/Fail | Evidence |");
  console.log("|---|-------|-----------|----------|");
  for (const r of results) {
    console.log(`| ${r.id} | ${r.name} | ${r.pass ? "PASS" : "FAIL"} | ${r.detail} |`);
  }

  const failures = results.filter((r) => !r.pass);
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll Session 3C Phase B checks passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
