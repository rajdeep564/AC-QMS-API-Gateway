import "dotenv/config";
import { MasterStatus, Role } from "@prisma/client";
import { prisma } from "../src/lib/prisma-types";
import { getMasterAllowedActions } from "../src/services/master-workflow.service";
import { GLYCINE_MASTER_FIELD_COUNT } from "./lib/glycine-baseline";

/** Rev 2.3 application tables (Bible Part 2 list; headline "22" omits users + departments). */
const EXPECTED_TABLES = [
  "users",
  "departments",
  "products",
  "product_masters",
  "product_master_fields",
  "specs",
  "spec_tests",
  "moa_docs",
  "moa_doc_sections",
  "batches",
  "batch_documents",
  "spec_document_tests",
  "moa_document_sections",
  "aws_sections",
  "coa_results",
  "file_attachments",
  "instruments",
  "reagents",
  "change_controls",
  "change_control_notifications",
  "audit_logs",
  "notifications",
  "sessions",
  "arn_sequences",
] as const;

async function listApplicationTables(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT IN ('_prisma_migrations')
    ORDER BY table_name
  `;
  return rows.map((r) => r.table_name);
}

async function main() {
  const failures: string[] = [];

  const tableNames = await listApplicationTables();
  const expectedSet = new Set<string>(EXPECTED_TABLES);
  const actualSet = new Set(tableNames);

  const missing = EXPECTED_TABLES.filter((t) => !actualSet.has(t));
  const extra = tableNames.filter((t) => !expectedSet.has(t));

  if (missing.length > 0) {
    failures.push(`Missing tables: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    failures.push(`Unexpected tables: ${extra.join(", ")}`);
  }
  if (tableNames.length !== EXPECTED_TABLES.length) {
    failures.push(
      `Expected ${EXPECTED_TABLES.length} application tables, found ${tableNames.length}`,
    );
  }

  const userCount = await prisma.user.count({ where: { deletedAt: null } });
  if (userCount !== 7) {
    failures.push(`Expected 7 users, found ${userCount}`);
  }

  const rajesh = await prisma.user.findFirst({
    where: { username: "rajesh.kumar", role: Role.SADMIN },
  });
  if (!rajesh) {
    failures.push("Rajesh Kumar (SADMIN) not found");
  }

  const diya = await prisma.user.findFirst({
    where: { username: "diya.sharma", role: Role.MKT_EXEC },
  });
  if (!diya) {
    failures.push("Diya Sharma (MKT_EXEC) not found");
  }

  const glycine = await prisma.product.findFirst({ where: { name: "Glycine" } });
  if (!glycine) {
    failures.push("Glycine product not found");
  }

  const activeMaster = glycine
    ? await prisma.productMaster.findFirst({
        where: { productId: glycine.id, status: MasterStatus.ACTIVE },
        orderBy: { revisionNo: "desc" },
        include: { fields: true },
      })
    : null;

  if (!activeMaster) {
    failures.push("No ACTIVE Glycine product master");
  } else {
    const activeMasterCount = await prisma.productMaster.count({
      where: { productId: glycine!.id, status: MasterStatus.ACTIVE },
    });
    if (activeMasterCount !== 1) {
      failures.push(
        `Expected exactly 1 ACTIVE Glycine master, found ${activeMasterCount}`,
      );
    }
    if (activeMaster.revisionNo < 1) {
      failures.push(`ACTIVE master revision must be >= 1, got ${activeMaster.revisionNo}`);
    }
    if (activeMaster.fields.length !== GLYCINE_MASTER_FIELD_COUNT) {
      failures.push(
        `Expected ${GLYCINE_MASTER_FIELD_COUNT} EAV fields, got ${activeMaster.fields.length}`,
      );
    }
    if (rajesh && activeMaster.createdById !== rajesh.id) {
      failures.push("ACTIVE master was not created by Rajesh");
    }
  }

  const draftActions = getMasterAllowedActions(
    MasterStatus.DRAFT,
    Role.SADMIN,
    rajesh?.id ?? "",
    null,
  );
  if (!draftActions.includes("APPROVE") || !draftActions.includes("ASSIGN")) {
    failures.push("SADMIN DRAFT allowedActions missing APPROVE or ASSIGN");
  }

  const specTemplateTable = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'spec_templates'
    ) AS exists
  `;
  if (specTemplateTable[0]?.exists) {
    failures.push("spec_templates table should not exist in Rev 2.3");
  }

  if (failures.length > 0) {
    console.error("Session 1 verification FAILED:");
    for (const f of failures) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  }

  console.log("Session 1 verification PASSED");
  console.log(`  Tables: ${tableNames.length}`);
  console.log(`  Users: ${userCount}`);
  console.log(`  Glycine ACTIVE master revision: ${activeMaster?.revisionNo}`);
  console.log(`  Glycine master fields: ${activeMaster?.fields.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
