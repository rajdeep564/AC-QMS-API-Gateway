/**
 * Track B / B-2.5 verification — document persistence (storage adapter + file_attachments).
 */
import "dotenv/config";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import {
  BatchStatus,
  DocStatus,
  DocType,
  FileType,
  Role,
} from "@prisma/client";
import { prisma } from "../src/lib/prisma-types";
import {
  approveBatch,
  createBatch,
  submitBatch,
} from "../src/modules/batches/batches.service";
import { signAndIssueCoa, transitionDocument } from "../src/modules/documents/documents.service";
import { drainDocumentRenderQueues, executeDocumentRender } from "../src/services/render-documents.service";
import {
  getDocumentStorage,
  LocalFileStorage,
  resetDocumentStorageCache,
  setDocumentStorageForTest,
  type DocumentStorage,
} from "../src/services/storage";
import { JwtAccessPayload } from "../src/types/auth.types";
import {
  SAMPLE_SPEC_BODY,
  fillAndCompleteAllSections,
} from "./lib/aws-section-fixture";
import {
  DEV_PASSWORD,
  ensureQaSignedHarnessSpec,
  ensureVerifierActiveMaster,
  ensureVerifierProduct,
} from "./lib/verifier-harness";

const DOC_MODULE_URL = process.env.DOC_MODULE_URL ?? "http://localhost:8000";

type CheckResult = { id: number; name: string; pass: boolean; detail: string };

function actor(userId: string, role: Role, departmentId: string | null = null): JwtAccessPayload {
  return { userId, role, departmentId };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function getUser(username: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { username } });
  return u;
}

async function deleteBatchFixture(batchId: string) {
  await drainDocumentRenderQueues(60_000);
  const docs = await prisma.batchDocument.findMany({ where: { batchId }, select: { id: true } });
  const docIds = docs.map((d) => d.id);
  if (docIds.length) {
    await prisma.fileAttachment.deleteMany({ where: { batchDocumentId: { in: docIds } } });
  }
  await prisma.awsSection.deleteMany({ where: { batchDocument: { batchId } } });
  await prisma.coaResult.deleteMany({ where: { batchDocument: { batchId } } });
  await prisma.batchDocument.deleteMany({ where: { batchId } });
  await prisma.moaDocumentSection.deleteMany({ where: { batchId } });
  await prisma.specDocumentTest.deleteMany({ where: { batchId } });
  await prisma.batch.deleteMany({ where: { id: batchId } });
}

async function deleteSpecFixture(productId: string) {
  await drainDocumentRenderQueues(60_000);
  const batches = await prisma.batch.findMany({ where: { productId }, select: { id: true } });
  for (const batch of batches) {
    await deleteBatchFixture(batch.id);
  }
  const specs = await prisma.spec.findMany({ where: { productId }, select: { id: true } });
  for (const s of specs) {
    await prisma.fileAttachment.deleteMany({ where: { specId: s.id } });
  }
  await prisma.moaDocSection.deleteMany({ where: { moaDoc: { spec: { productId } } } });
  await prisma.moaDoc.deleteMany({ where: { spec: { productId } } });
  await prisma.specTest.deleteMany({ where: { spec: { productId } } });
  await prisma.spec.deleteMany({ where: { productId } });
}

async function createCoaReadyFixture(batchNoSuffix: string) {
  const verifierProduct = await ensureVerifierProduct();
  await ensureVerifierActiveMaster((await getUser("kavya.patel")).id);

  const kavya = await getUser("kavya.patel");
  const meera = await getUser("meera.iyer");
  const priya = await getUser("priya.mehta");
  const sanjay = await getUser("sanjay.reddy");

  const batchNo = `B25-${batchNoSuffix}`;
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

  const awsDoc = await prisma.batchDocument.findFirstOrThrow({
    where: { batchId: created.batch.id, docType: DocType.AWS },
  });

  const sections = await prisma.awsSection.findMany({
    where: { batchDocumentId: awsDoc.id },
    include: { specDocumentTest: true },
    orderBy: { specDocumentTest: { sortOrder: "asc" } },
  });

  await fillAndCompleteAllSections({
    sections: sections.map((s) => ({
      id: s.id,
      testName: s.specDocumentTest.testName,
    })),
    analystId: kavya.id,
    checkerId: meera.id,
  });

  await transitionDocument(awsDoc.id, "SUBMIT", actor(kavya.id, Role.QC_EXEC), DEV_PASSWORD);
  await transitionDocument(awsDoc.id, "APPROVE", actor(priya.id, Role.QC_MGR), DEV_PASSWORD);
  await transitionDocument(awsDoc.id, "SIGN", actor(sanjay.id, Role.QA_MGR), DEV_PASSWORD);

  const coaDoc = await prisma.batchDocument.findFirstOrThrow({
    where: { batchId: created.batch.id, docType: DocType.COA },
  });
  assert(coaDoc.status === DocStatus.AUTO_GENERATED, "COA must be AUTO_GENERATED");

  return {
    productId: verifierProduct.id,
    batchId: created.batch.id,
    batchNo,
    awsDocId: awsDoc.id,
    coaDocId: coaDoc.id,
    sanjayId: sanjay.id,
  };
}

async function docModuleReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${DOC_MODULE_URL.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function runCheck(
  id: number,
  name: string,
  fn: () => Promise<string>,
): Promise<CheckResult> {
  try {
    const detail = await fn();
    return { id, name, pass: true, detail };
  } catch (err) {
    return {
      id,
      name,
      pass: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

class FailingStorage implements DocumentStorage {
  async save(): Promise<never> {
    throw new Error("Simulated storage failure (B-2.5 #7)");
  }
  async read(): Promise<never> {
    throw new Error("Simulated storage failure");
  }
  async exists(): Promise<boolean> {
    return false;
  }
  resolveAbsolute(key: string): string {
    return key;
  }
}

async function main() {
  const results: CheckResult[] = [];

  results.push(
    await runCheck(1, "DocumentStorage interface + LocalFileStorage; no fs in render path", async () => {
      const storage = getDocumentStorage();
      assert(storage instanceof LocalFileStorage, "default adapter must be LocalFileStorage");
      const renderSrc = readFileSync(
        join(__dirname, "../src/services/render-documents.service.ts"),
        "utf8",
      );
      const persistSrc = readFileSync(
        join(__dirname, "../src/services/persist-rendered-document.ts"),
        "utf8",
      );
      assert(
        !renderSrc.includes('from "fs"') && !renderSrc.includes("from 'fs'"),
        "render-documents must not import fs",
      );
      assert(
        !persistSrc.includes('from "fs"') && !persistSrc.includes("from 'fs'"),
        "persist helper must not import fs",
      );
      assert(persistSrc.includes("persistRenderedDocument"), "persist helper present");
      assert(persistSrc.includes("getDocumentStorage"), "persist uses adapter");
      return "LocalFileStorage + no fs outside adapter in render/persist";
    }),
  );

  results.push(
    await runCheck(2, "DOCUMENT_STORAGE_ROOT configurable", async () => {
      const { config } = await import("../src/config/env");
      assert(typeof config.documentStorageRoot === "string", "root configured");
      assert(config.documentStorageRoot.length > 0, "root non-empty");
      const example = readFileSync(join(__dirname, "../.env.example"), "utf8");
      assert(example.includes("DOCUMENT_STORAGE_ROOT"), ".env.example lists DOCUMENT_STORAGE_ROOT");
      return `root=${config.documentStorageRoot}`;
    }),
  );

  results.push(
    await runCheck(3, "file_attachments schema gap flagged (no silent migration)", async () => {
      const schema = readFileSync(join(__dirname, "../prisma/schema.prisma"), "utf8");
      assert(schema.includes("model FileAttachment"), "FileAttachment model exists");
      assert(schema.includes("filePath"), "filePath present");
      assert(schema.includes("generatedBy"), "generatedBy present");
      assert(schema.includes("fileType"), "fileType present");
      // Document intentionally: no byteLength/docType/filename columns — derivable
      const gaps = [
        "docType (derive via batchDocument join)",
        "filename (derive from filePath basename)",
        "contentType (derive from fileType enum)",
        "byteLength (verify via storage.read().length)",
      ];
      console.log("\n=== CHECK #3 SCHEMA GAP REPORT ===");
      for (const g of gaps) console.log(`  - NOT on row: ${g}`);
      console.log("  Recommendation: no migration for Phase 2");
      return `gaps flagged: ${gaps.length}; no migration`;
    }),
  );

  const reachable = await docModuleReachable();

  // #4 RUNTIME milestone
  console.log("\n=== CHECK #4 RAW OUTPUT — first persisted COA document ===");
  if (!reachable) {
    results.push({
      id: 4,
      name: "RUNTIME — sign-and-issue COA → DOCX on disk + file_attachments row",
      pass: false,
      detail: "DOC-Module not reachable",
    });
    console.log("SKIP — DOC-Module not reachable");
  } else {
    const fixture = await createCoaReadyFixture(`persist-${Date.now()}`);
    try {
      await signAndIssueCoa(fixture.coaDocId, actor(fixture.sanjayId, Role.QA_MGR), DEV_PASSWORD);
      const renderResult = await executeDocumentRender({
        kind: "COA",
        batchDocumentId: fixture.coaDocId,
        actorId: fixture.sanjayId,
      });
      const coa = await prisma.batchDocument.findUniqueOrThrow({ where: { id: fixture.coaDocId } });
      const batch = await prisma.batch.findUniqueOrThrow({ where: { id: fixture.batchId } });
      const rows = await prisma.fileAttachment.findMany({
        where: { batchDocumentId: fixture.coaDocId },
        orderBy: { createdAt: "asc" },
      });
      const docx = rows.find((r) => r.fileType === FileType.DOCX);
      assert(renderResult.status === "rendered", `render status=${renderResult.status}`);
      assert(coa.status === DocStatus.ISSUED, "COA ISSUED");
      assert(batch.status === BatchStatus.RELEASED, "batch RELEASED");
      assert(docx != null, "DOCX attachment row missing");
      const storage = getDocumentStorage();
      const abs = storage.resolveAbsolute(docx!.filePath);
      const bytes = await storage.read(docx!.filePath);
      console.log("COA status:", coa.status);
      console.log("Batch status:", batch.status);
      console.log("Absolute file path:", abs);
      console.log("file_attachments row:", JSON.stringify(docx, null, 2));
      console.log("DOCX byteLength:", bytes.length);
      assert(bytes.length > 1000, "DOCX too small");
      assert(bytes[0] === 0x50 && bytes[1] === 0x4b, "DOCX must start with PK (zip)");
      results.push({
        id: 4,
        name: "RUNTIME — sign-and-issue COA → DOCX on disk + file_attachments row",
        pass: true,
        detail: `path=${docx!.filePath} bytes=${bytes.length} id=${docx!.id}`,
      });

      // #5 covered by PK + length above
      results.push({
        id: 5,
        name: "Saved file is a valid DOCX (byteLength + PK magic)",
        pass: true,
        detail: `byteLength=${bytes.length}, magic=PK`,
      });

      // #6 append-only re-render
      const beforeIds = new Set(rows.map((r) => r.id));
      const beforePaths = new Set(rows.map((r) => r.filePath));
      const retry = await executeDocumentRender({
        kind: "COA",
        batchDocumentId: fixture.coaDocId,
        actorId: fixture.sanjayId,
      });
      assert(retry.status === "rendered", `retry status=${retry.status}`);
      const after = await prisma.fileAttachment.findMany({
        where: { batchDocumentId: fixture.coaDocId },
        orderBy: { createdAt: "asc" },
      });
      assert(after.length > rows.length, "expected new attachment rows on re-render");
      for (const id of beforeIds) {
        assert(
          after.some((r) => r.id === id),
          `prior row ${id} must not be destroyed`,
        );
      }
      for (const p of beforePaths) {
        assert(await storage.exists(p), `prior file ${p} must still exist`);
      }
      results.push({
        id: 6,
        name: "Re-render append-only (new row; prior retained)",
        pass: true,
        detail: `before=${rows.length} after=${after.length}`,
      });
    } catch (err) {
      results.push({
        id: 4,
        name: "RUNTIME — sign-and-issue COA → DOCX on disk + file_attachments row",
        pass: false,
        detail: err instanceof Error ? err.message : String(err),
      });
      results.push({
        id: 5,
        name: "Saved file is a valid DOCX (byteLength + PK magic)",
        pass: false,
        detail: "skipped — #4 failed",
      });
      results.push({
        id: 6,
        name: "Re-render append-only (new row; prior retained)",
        pass: false,
        detail: "skipped — #4 failed",
      });
    } finally {
      await drainDocumentRenderQueues();
      await deleteBatchFixture(fixture.batchId);
      // leave harness specs; deleteBatch covers attachments
    }
  }

  // #7 persistence failure non-blocking
  console.log("\n=== CHECK #7 RAW OUTPUT — persistence failure non-blocking ===");
  if (!reachable) {
    results.push({
      id: 7,
      name: "RUNTIME — persistence failure non-blocking",
      pass: false,
      detail: "DOC-Module not reachable",
    });
    console.log("SKIP — DOC-Module not reachable");
  } else {
    const fixture = await createCoaReadyFixture(`persist-fail-${Date.now()}`);
    try {
      setDocumentStorageForTest(new FailingStorage());
      await signAndIssueCoa(fixture.coaDocId, actor(fixture.sanjayId, Role.QA_MGR), DEV_PASSWORD);
      const renderResult = await executeDocumentRender({
        kind: "COA",
        batchDocumentId: fixture.coaDocId,
        actorId: fixture.sanjayId,
      });
      const coa = await prisma.batchDocument.findUniqueOrThrow({ where: { id: fixture.coaDocId } });
      const batch = await prisma.batch.findUniqueOrThrow({ where: { id: fixture.batchId } });
      console.log("renderResult:", JSON.stringify(renderResult));
      console.log("COA status:", coa.status, "renderStatus:", coa.renderStatus, "renderError:", coa.renderError);
      console.log("Batch status:", batch.status);
      assert(coa.status === DocStatus.ISSUED, "COA must remain ISSUED");
      assert(batch.status === BatchStatus.RELEASED, "batch must remain RELEASED");
      assert(renderResult.status === "rendered", "persist failure must not report render_failed");
      const attCount = await prisma.fileAttachment.count({
        where: { batchDocumentId: fixture.coaDocId },
      });
      console.log("attachment count after forced storage fail:", attCount);
      assert(attCount === 0, "no attachment rows when storage fails");
      results.push({
        id: 7,
        name: "RUNTIME — persistence failure non-blocking",
        pass: true,
        detail: `COA=${coa.status} batch=${batch.status} renderStatus=${coa.renderStatus}`,
      });
    } catch (err) {
      results.push({
        id: 7,
        name: "RUNTIME — persistence failure non-blocking",
        pass: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDocumentStorageForTest(null);
      resetDocumentStorageCache();
      await drainDocumentRenderQueues();
      await deleteBatchFixture(fixture.batchId);
    }
  }

  // #8 render failure still non-blocking
  console.log("\n=== CHECK #8 RAW OUTPUT — render failure non-blocking (B-2.2 regression) ===");
  {
    const fixture = await createCoaReadyFixture(`render-fail-${Date.now()}`);
    try {
      // Break product_code so mapper fails before DOC-Module / persist
      const master = await prisma.productMaster.findFirst({
        where: { productId: fixture.productId, status: "ACTIVE" },
        include: { fields: true },
      });
      const codeField = master?.fields.find((f) => f.fieldKey === "product_code");
      assert(!!codeField, "product_code field required");
      const saved = codeField!.value;
      await prisma.productMasterField.update({
        where: { id: codeField!.id },
        data: { value: "" },
      });

      await signAndIssueCoa(fixture.coaDocId, actor(fixture.sanjayId, Role.QA_MGR), DEV_PASSWORD);
      const beforeAtt = await prisma.fileAttachment.count({
        where: { batchDocumentId: fixture.coaDocId },
      });
      const renderResult = await executeDocumentRender({
        kind: "COA",
        batchDocumentId: fixture.coaDocId,
        actorId: fixture.sanjayId,
      });
      await prisma.productMasterField.update({
        where: { id: codeField!.id },
        data: { value: saved },
      });

      const coa = await prisma.batchDocument.findUniqueOrThrow({ where: { id: fixture.coaDocId } });
      const batch = await prisma.batch.findUniqueOrThrow({ where: { id: fixture.batchId } });
      const afterAtt = await prisma.fileAttachment.count({
        where: { batchDocumentId: fixture.coaDocId },
      });
      console.log("renderResult:", JSON.stringify(renderResult));
      console.log("COA status:", coa.status, "renderStatus:", coa.renderStatus);
      console.log("Batch status:", batch.status);
      console.log("attachments before/after:", beforeAtt, afterAtt);
      assert(coa.status === DocStatus.ISSUED, "COA still ISSUED");
      assert(batch.status === BatchStatus.RELEASED, "batch still RELEASED");
      assert(renderResult.status === "render_failed", "expected render_failed");
      assert(afterAtt === beforeAtt, "no new attachments when render fails");
      results.push({
        id: 8,
        name: "RUNTIME — render failure still non-blocking (B-2.2)",
        pass: true,
        detail: `COA=${coa.status} batch=${batch.status} status=${renderResult.status}`,
      });
    } catch (err) {
      results.push({
        id: 8,
        name: "RUNTIME — render failure still non-blocking (B-2.2)",
        pass: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      await drainDocumentRenderQueues();
      await deleteBatchFixture(fixture.batchId);
    }
  }

  results.push(
    await runCheck(9, "persistRenderedDocument is doc-type-agnostic", async () => {
      const src = readFileSync(
        join(__dirname, "../src/services/persist-rendered-document.ts"),
        "utf8",
      );
      assert(src.includes("docTypeLabel"), "accepts docTypeLabel");
      assert(src.includes("batchDocumentId"), "accepts batchDocumentId");
      assert(src.includes("specId"), "accepts specId");
      const renderSrc = readFileSync(
        join(__dirname, "../src/services/render-documents.service.ts"),
        "utf8",
      );
      assert(renderSrc.includes('docTypeLabel: "COA"'), "COA calls helper");
      assert(renderSrc.includes('docTypeLabel: "AWS"'), "AWS calls helper");
      assert(renderSrc.includes('docTypeLabel: "SPEC"'), "SPEC calls helper");
      assert(renderSrc.includes('docTypeLabel: "MOA"'), "MOA calls helper");
      return "COA/AWS/SPEC/MOA share persistRenderedDocument";
    }),
  );

  results.push(
    await runCheck(10, "AWS/SPEC/MOA render still live (Epic 21 kept)", async () => {
      const renderSrc = readFileSync(
        join(__dirname, "../src/services/render-documents.service.ts"),
        "utf8",
      );
      assert(renderSrc.includes("async function renderAws"), "AWS render live");
      assert(renderSrc.includes("async function renderStandingSpec"), "SPEC render live");
      assert(renderSrc.includes("async function renderCoa"), "COA render live");
      assert(!renderSrc.includes('status: "queued"'), "no queued stubs");
      return "All Epic 21 render paths persist (not COA-only stubs)";
    }),
  );

  results.push(
    await runCheck(11, "typecheck green (slice-local)", async () => {
      execSync("npm run typecheck", { cwd: join(__dirname, ".."), stdio: "pipe" });
      return "typecheck OK";
    }),
  );

  console.log("\n=== B-2.5 VERIFICATION TABLE ===");
  console.log("| # | Check | Pass/Fail | Evidence |");
  console.log("|---|-------|-----------|----------|");
  for (const r of results.sort((a, b) => a.id - b.id)) {
    const evidence = r.detail.length > 80 ? `${r.detail.slice(0, 77)}...` : r.detail;
    console.log(`| ${r.id} | ${r.name} | ${r.pass ? "Pass" : "Fail"} | ${evidence} |`);
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll B-2.5 checks PASSED");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    setDocumentStorageForTest(null);
    await prisma.$disconnect();
  });
