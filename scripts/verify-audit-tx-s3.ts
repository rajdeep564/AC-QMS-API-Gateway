import "dotenv/config";
import { prisma } from "../src/lib/prisma-types";
import * as auditRepo from "../src/services/audit.repository";
import { AuditAction, AuditEntityType } from "../src/services/audit.service";

async function getAuditLog() {
  const { log } = await import("../src/services/audit.service");
  return log;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function auditProbeData(marker: string) {
  return {
    timestamp: new Date(),
    action: AuditAction.CREATE,
    entityType: AuditEntityType.PRODUCT,
    comment: marker,
  };
}

async function testFailClosedWithTx(): Promise<void> {
  const auditLog = await getAuditLog();
  const mockTx = {
    auditLog: {
      create: async () => {
        throw new Error("FORCED_AUDIT_FAILURE");
      },
    },
  };

  let threw = false;
  try {
    await auditLog(
      {
        action: AuditAction.CREATE,
        entityType: AuditEntityType.PRODUCT,
        entityId: "00000000-0000-0000-0000-000000000001",
      },
      mockTx as never,
    );
  } catch (error) {
    threw = true;
    assert(
      error instanceof Error && error.message === "FORCED_AUDIT_FAILURE",
      "Expected FORCED_AUDIT_FAILURE to propagate when tx is supplied",
    );
  }

  assert(threw, "auditLog must throw when tx client is supplied and audit write fails");
  console.log("  PASS — fail-closed when tx supplied");
}

async function testLogAndContinueWithoutTx(): Promise<void> {
  const original = auditRepo.createAuditLog;
  auditRepo.createAuditLog = async () => {
    throw new Error("FORCED_STANDALONE_AUDIT_FAILURE");
  };

  const auditLog = await getAuditLog();

  let threw = false;
  try {
    await auditLog({
      action: AuditAction.LOGIN,
      entityType: AuditEntityType.USER,
      entityId: "00000000-0000-0000-0000-000000000002",
    });
  } catch {
    threw = true;
  } finally {
    auditRepo.createAuditLog = original;
  }

  assert(!threw, "auditLog must not throw when no tx is supplied (log-and-continue)");
  console.log("  PASS — log-and-continue when no tx supplied");
}

async function testPrismaTransactionRollbackBaseline(): Promise<void> {
  const marker = `S3_BASELINE_ROLLBACK_${Date.now()}`;
  const countBefore = await prisma.auditLog.count({
    where: { comment: { startsWith: marker } },
  });
  assert(countBefore === 0, "Baseline marker must not exist before test");

  let threw = false;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: auditProbeData(`${marker}:mutation`),
      });
      throw new Error("SIMULATED_POST_MUTATION_FAILURE");
    });
  } catch (error) {
    threw = true;
    assert(
      error instanceof Error && error.message === "SIMULATED_POST_MUTATION_FAILURE",
      "Baseline transaction must propagate simulated failure",
    );
  }

  assert(threw, "Baseline transaction must throw");
  const countAfter = await prisma.auditLog.count({
    where: { comment: { startsWith: marker } },
  });
  assert(countAfter === 0, "Baseline: mutation row must not persist after transaction rollback");
  console.log("  PASS — Prisma transaction rollback baseline");
}

async function testMutationRollbackOnInTxAuditFailure(): Promise<void> {
  const marker = `S3_AUDIT_ROLLBACK_${Date.now()}`;
  const countBefore = await prisma.auditLog.count({
    where: { comment: { startsWith: marker } },
  });
  assert(countBefore === 0, "Rollback marker must not exist before test");

  const auditLog = await getAuditLog();

  let serviceThrew = false;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: auditProbeData(`${marker}:mutation`),
      });

      // Simulate audit.service log() fail-closed path after a successful mutation in the same tx.
      await auditLog(
        {
          ...auditProbeData(`${marker}:audit`),
          action: AuditAction.UPDATE,
        },
        {
          auditLog: {
            create: async () => {
              throw new Error("FORCED_IN_TX_AUDIT_FAILURE");
            },
          },
        } as never,
      );
    });
  } catch (error) {
    serviceThrew = true;
    assert(
      error instanceof Error && error.message === "FORCED_IN_TX_AUDIT_FAILURE",
      "Transaction must propagate in-tx audit failure",
    );
  }

  assert(serviceThrew, "Transaction must throw when in-tx audit fails");

  const countAfter = await prisma.auditLog.count({
    where: { comment: { startsWith: marker } },
  });
  assert(
    countAfter === 0,
    `Orphan rows must not persist after audit failure (found ${countAfter})`,
  );

  console.log(
    "  PASS — in-tx audit failure rolls back prior mutation in same transaction (products.service pattern)",
  );
}

async function main() {
  const failures: string[] = [];

  const tests: Array<[string, () => Promise<void>]> = [
    ["Log-and-continue when no tx", testLogAndContinueWithoutTx],
    ["Fail-closed when tx supplied", testFailClosedWithTx],
    ["Prisma transaction rollback baseline", testPrismaTransactionRollbackBaseline],
    ["In-tx audit failure rolls back mutation", testMutationRollbackOnInTxAuditFailure],
  ];

  for (const [name, fn] of tests) {
    try {
      console.log(`\n[${name}]`);
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${name}: ${message}`);
      console.error(`  FAIL — ${message}`);
    }
  }

  console.log("\n---");
  if (failures.length > 0) {
    console.error(`verify-audit-tx-s3: ${failures.length} failure(s)`);
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }

  console.log("verify-audit-tx-s3: all checks passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
