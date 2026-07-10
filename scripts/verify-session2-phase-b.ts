/**
 * Session 2 Phase B verification — standing SPEC audit tx-integrity (S3(b)) and gap closures.
 */
import "dotenv/config";
import { MasterStatus, ResultType, SpecVariant, StandingDocStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma-types";
import { AppError } from "../src/lib/app-error";
import { AuditAction, AuditEntityType } from "../src/services/audit.service";
import * as specsRepo from "../src/modules/specs/specs.repository";
import { assertRevisionChangeControlSeam } from "../src/modules/specs/specs.change-control";
import { validateSpecContentAtSave } from "../src/modules/specs/specs.validation";

type CheckResult = { name: string; pass: boolean; detail: string };

const ROLLBACK_FIXTURE_TESTS: specsRepo.SpecTestInput[] = [
  {
    sortOrder: 1,
    testName: "Rollback Proof",
    resultType: ResultType.QUALITATIVE,
    acceptanceCriteria: "N/A",
  },
];

const ROLLBACK_FIXTURE_MOA_SECTIONS: specsRepo.MoaSectionInput[] = [
  { specTestRef: 0, pharmacopoeia: "IP", samplePreparation: "Fixture only" },
];

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

async function createRollbackFixture(): Promise<{ specId: string; createdById: string }> {
  const product = await prisma.product.findFirst({ where: { name: "Glycine" } });
  if (!product) {
    throw new Error("Glycine product must be seeded (npm run seed)");
  }

  const activeMaster = await prisma.productMaster.findFirst({
    where: { productId: product.id, status: MasterStatus.ACTIVE },
  });
  if (!activeMaster) {
    throw new Error("Glycine must have an ACTIVE Product Master");
  }

  const qcExec = await prisma.user.findFirst({
    where: { username: "kavya.patel", deletedAt: null },
  });
  if (!qcExec) {
    throw new Error("QC_EXEC user kavya.patel must be seeded");
  }

  const stamp = Date.now();
  const specNo = `ROLLBACK-TEST/${stamp}`.slice(0, 80);
  const moaNo = `MOA-ROLLBACK/${stamp}`.slice(0, 80);

  const spec = await prisma.$transaction(async (tx) =>
    specsRepo.createSpecWithMoaPair(
      {
        productId: product.id,
        variant: SpecVariant.GENERAL,
        specNo,
        moaNo,
        revisionNo: 90_000 + (stamp % 1_000),
        createdById: qcExec.id,
        tests: ROLLBACK_FIXTURE_TESTS,
        moaSections: ROLLBACK_FIXTURE_MOA_SECTIONS,
      },
      tx,
    ),
  );

  if (!spec || spec.status !== StandingDocStatus.DRAFT || !spec.moaDoc) {
    throw new Error("Rollback fixture SPEC+MOA was not created in DRAFT");
  }

  return { specId: spec.id, createdById: qcExec.id };
}

async function deleteRollbackFixture(specId: string): Promise<void> {
  await prisma.moaDocSection.deleteMany({ where: { moaDoc: { specId } } });
  await prisma.specTest.deleteMany({ where: { specId } });
  await prisma.moaDoc.deleteMany({ where: { specId } });
  await prisma.spec.delete({ where: { id: specId } });
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
            throw new Error("FORCED_STANDING_SPEC_AUDIT_FAILURE");
          },
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
}

async function testStandingSpecSubmitAuditRollback(): Promise<void> {
  let specId: string | null = null;

  try {
    const fixture = await createRollbackFixture();
    specId = fixture.specId;
    const beforeStatus = StandingDocStatus.DRAFT;

    let rolledBack = false;
    try {
      await prisma.$transaction(async (tx) => {
        await specsRepo.updateSpecAndMoaStatus(
          specId!,
          {
            status: StandingDocStatus.SUBMITTED,
            submittedById: fixture.createdById,
            qcApprovedById: null,
            qaSignedById: null,
            approvedAt: null,
          },
          txWithForcedAuditFailure(tx),
          {
            userId: fixture.createdById,
            action: AuditAction.SUBMIT,
            entityType: AuditEntityType.SPEC,
            entityId: specId!,
            oldStatus: beforeStatus,
          },
        );
      });
    } catch (error) {
      rolledBack =
        error instanceof Error && error.message === "FORCED_STANDING_SPEC_AUDIT_FAILURE";
    }

    assert(rolledBack, "Expected forced in-tx audit failure during standing SPEC status update");

    const after = await prisma.spec.findUniqueOrThrow({ where: { id: specId } });
    const moaAfter = await prisma.moaDoc.findUniqueOrThrow({ where: { specId } });
    assert(after.status === beforeStatus, "SPEC status must roll back when in-tx audit fails");
    assert(moaAfter.status === beforeStatus, "MOA status must roll back when in-tx audit fails");
    console.log("  PASS — in-tx audit failure rolls back standing SPEC+MOA transition");
  } finally {
    if (specId) {
      await deleteRollbackFixture(specId);
    }
  }
}

async function main() {
  console.log("Session 2 Phase B verification\n");

  const results: CheckResult[] = [];

  results.push(
    await runCheck("audit rollback proof (#7)", async () => {
      await testStandingSpecSubmitAuditRollback();
    }),
  );

  results.push(
    await runCheck("status filter (US-4-6)", async () => {
      const product = await prisma.product.findFirst({ where: { name: "Glycine" } });
      assert(Boolean(product), "Glycine product must be seeded (npm run seed)");
      const signed = await specsRepo.listSpecsByProduct(product!.id, StandingDocStatus.QA_SIGNED);
      for (const row of signed) {
        assert(row.status === StandingDocStatus.QA_SIGNED, "status filter must return only matching rows");
      }
      console.log("  PASS — listSpecsByProduct status filter");
    }),
  );

  results.push(
    await runCheck("duplicate sort_order rejected (US-5-1)", () => {
      let threw = false;
      try {
        validateSpecContentAtSave([
          { sortOrder: 1, testName: "A", resultType: "QUALITATIVE" },
          { sortOrder: 1, testName: "B", resultType: "QUALITATIVE" },
        ] as never);
      } catch (error) {
        threw = error instanceof AppError && error.code === "VALIDATION_ERROR";
      }
      assert(threw, "duplicate sort_order must reject with 422");
      console.log("  PASS — duplicate sort_order rejected");
    }),
  );

  results.push(
    await runCheck("undeclared formula variable rejected (US-5-9)", () => {
      let threw = false;
      try {
        validateSpecContentAtSave([
          {
            sortOrder: 1,
            testName: "Assay",
            resultType: "QUANTITATIVE",
            formula: "x + y",
            formulaVariables: { variables: [{ name: "x" }] },
          },
        ] as never);
      } catch (error) {
        threw =
          error instanceof AppError &&
          error.code === "VALIDATION_ERROR" &&
          String(error.message).includes("y");
      }
      assert(threw, "undeclared formula variable must reject with 422 naming token");
      console.log("  PASS — undeclared formula variable rejected");
    }),
  );

  results.push(
    await runCheck("unparseable formula rejected (US-5-9)", () => {
      let threw = false;
      try {
        validateSpecContentAtSave([
          {
            sortOrder: 1,
            testName: "Assay",
            resultType: "QUANTITATIVE",
            formula: "x + )",
            formulaVariables: { variables: [{ name: "x" }] },
          },
        ] as never);
      } catch (error) {
        threw =
          error instanceof AppError &&
          error.code === "VALIDATION_ERROR" &&
          String(error.message).includes("not parseable");
      }
      assert(threw, "unparseable formula must reject with 422");
      console.log("  PASS — unparseable formula rejected");
    }),
  );

  results.push(
    await runCheck("valid formula with all vars declared passes (US-5-9)", () => {
      const result = validateSpecContentAtSave([
        {
          sortOrder: 1,
          testName: "Assay",
          resultType: "QUANTITATIVE",
          formula: "x + y",
          formulaVariables: { variables: [{ name: "x" }, { name: "y" }] },
        },
      ] as never);
      assert(result.length === 1 && result[0]!.sortOrder === 1, "valid formula must pass");
      console.log("  PASS — valid formula with all vars declared");
    }),
  );

  results.push(
    await runCheck("CC seam 501 (US-4-5)", () => {
      let threw = false;
      try {
        assertRevisionChangeControlSeam("00000000-0000-0000-0000-000000000001");
      } catch (error) {
        threw = error instanceof AppError && error.statusCode === 501;
      }
      assert(threw, "changeControlId on revise seam must return 501 Epic 27");
      console.log("  PASS — CC seam returns 501 when changeControlId supplied");
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
    console.log("\nOne or more Phase B checks failed.");
  } else {
    console.log("\nAll Phase B checks passed.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
