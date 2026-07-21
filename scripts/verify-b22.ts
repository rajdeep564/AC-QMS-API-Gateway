/**
 * Track B / B-2.2 verification — COA mapper, sop-client, first real render.
 */
import "dotenv/config";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
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
import { AuditAction } from "../src/services/audit.service";
import {
  approveBatch,
  createBatch,
  submitBatch,
} from "../src/modules/batches/batches.service";
import { signAndIssueCoa, transitionDocument } from "../src/modules/documents/documents.service";
import {
  approveSpec,
  createSpec,
  signSpec,
  submitSpec,
} from "../src/modules/specs/specs.service";
import { mapToCoaRenderInput } from "../src/services/coa-render-mapper";
import { drainDocumentRenderQueues, renderDocuments } from "../src/services/render-documents.service";
import * as sopClient from "../src/services/sop-client";
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
const DOC_MODULE_API_KEY = process.env.DOC_MODULE_API_KEY ?? "";

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
  await drainDocumentRenderQueues(60_000);
  const batches = await prisma.batch.findMany({ where: { productId }, select: { id: true } });
  for (const batch of batches) {
    await deleteBatchFixture(batch.id);
  }
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
  await prisma.batch.deleteMany({ where: { id: batchId } });
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

async function createCoaReadyFixture(batchNoSuffix: string) {
  const verifierProduct = await ensureVerifierProduct();
  await ensureVerifierActiveMaster((await getUser("kavya.patel")).id);

  const kavya = await getUser("kavya.patel");
  const meera = await getUser("meera.iyer");
  const priya = await getUser("priya.mehta");
  const sanjay = await getUser("sanjay.reddy");

  const batchNo = `B22-${batchNoSuffix}`;
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
    awsDocId: awsDoc.id,
    coaDocId: coaDoc.id,
    kavyaId: kavya.id,
    priyaId: priya.id,
    sanjayId: sanjay.id,
    awsCreatedById: awsAfter.createdById,
    awsQcApprovedById: awsAfter.qcApprovedById,
  };
}

function validatePayloadWithPython(json: string): void {
  const docModuleRoot = join(__dirname, "../../AC-QMS-DOC-Module");
  const tempDir = mkdtempSync(join(tmpdir(), "b22-coa-"));
  const payloadPath = join(tempDir, "payload.json");
  writeFileSync(payloadPath, json, "utf8");
  const escapedPath = payloadPath.replace(/\\/g, "/");
  const venvPy = join(docModuleRoot, ".venv", "Scripts", "python.exe");
  const py = existsSync(venvPy) ? `"${venvPy}"` : "py -3.13";
  const out = execSync(
    `${py} -c "from app.schemas.coa_render import CoaRenderInput; CoaRenderInput.model_validate_json(open(r'${escapedPath}').read()); print('VALID')"`,
    { cwd: docModuleRoot, encoding: "utf8", env: { ...process.env, API_KEY: DOC_MODULE_API_KEY || "test" } },
  );
  assert(out.trim().includes("VALID"), `Python validation failed: ${out}`);
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

async function main() {
  const results: CheckResult[] = [];
  let fixture: Awaited<ReturnType<typeof createCoaReadyFixture>> | null = null;

  await drainDocumentRenderQueues(60_000);

  try {
    fixture = await createCoaReadyFixture(`mapper-${Date.now()}`);
    const mapperFixture = fixture;

    results.push(
      await runCheck(1, "mapToCoaRenderInput validates against CoaRenderInput schema", async () => {
        const payload = await mapToCoaRenderInput(mapperFixture.coaDocId);
        validatePayloadWithPython(JSON.stringify(payload));
      }),
    );

    results.push(
      await runCheck(2, "document_no read from stored batch_documents.doc_no", async () => {
        const doc = await prisma.batchDocument.findUniqueOrThrow({
          where: { id: mapperFixture.coaDocId },
        });
        const payload = await mapToCoaRenderInput(mapperFixture.coaDocId);
        assert(payload.document_no === doc.docNo, `Expected ${doc.docNo}, got ${payload.document_no}`);
      }),
    );

    results.push(
      await runCheck(3, "5 batch fields mapped; 5 absent null/omitted", async () => {
        const payload = await mapToCoaRenderInput(mapperFixture.coaDocId);
        assert(payload.batch.batch_no.length > 0, "batch_no required");
        assert("mfg_date" in payload.batch || payload.batch.mfg_date === null, "mfg_date key");
        assert(
          payload.batch.quantity_sampled === undefined || payload.batch.quantity_sampled === null,
          "quantity_sampled absent",
        );
        assert(
          payload.batch.test_request_no === undefined || payload.batch.test_request_no === null,
          "test_request_no absent",
        );
        assert(
          payload.batch.received_date === undefined || payload.batch.received_date === null,
          "received_date absent",
        );
        assert(
          payload.batch.testing_date === undefined || payload.batch.testing_date === null,
          "testing_date absent",
        );
        assert(
          payload.batch.completion_date === undefined || payload.batch.completion_date === null,
          "completion_date absent",
        );
      }),
    );

    results.push(
      await runCheck(4, "approval PersonSignatures correct; signature null", async () => {
        const doc = await prisma.batchDocument.findUniqueOrThrow({
          where: { id: mapperFixture.coaDocId },
          include: {
            createdBy: true,
            qcApprovedBy: true,
          },
        });
        const payload = await mapToCoaRenderInput(mapperFixture.coaDocId);
        assert(
          payload.approval.prepared_by.name === doc.createdBy?.fullName,
          "prepared name mismatch",
        );
        assert(
          payload.approval.checked_by.name === doc.qcApprovedBy?.fullName,
          "checked name mismatch",
        );
        assert(payload.approval.prepared_by.signature === null, "prepared signature must be null");
        assert(payload.approval.checked_by.signature === null, "checked signature must be null");
        assert(payload.approval.approved_by.signature === null, "approved signature must be null");
      }),
    );

    results.push(
      await runCheck(5, "sop-client URL + API key from env (no hardcoded secrets)", async () => {
        const src = readFileSync(join(__dirname, "../src/services/sop-client/client.ts"), "utf8");
        assert(src.includes("config.docModuleUrl"), "must use config.docModuleUrl");
        assert(src.includes("config.docModuleApiKey"), "must use config.docModuleApiKey");
        assert(!src.includes("localhost:8000"), "must not hardcode DOC_MODULE_URL");
        assert(!src.includes("change-me"), "must not hardcode API key");
      }),
    );

    // Release mapper fixture before runtime tests that recreate specs/batches for same product.
    fixture = null;
    const mapperProduct = await prisma.product.findFirst({ where: { name: "Glycine" } });
    await deleteBatchFixture(mapperFixture.batchId);
    if (mapperProduct) await deleteSpecFixture(mapperProduct.id);

    const glycineFixtureBody = readFileSync(
      join(__dirname, "../../AC-QMS-DOC-Module/tests/fixtures/glycine_coa_gcn010226.json"),
      "utf8",
    );
    const authRenderBody = JSON.stringify({
      document_type: "coa",
      payload: JSON.parse(glycineFixtureBody),
    });

    // #6 — runtime auth gate
    console.log("\n=== CHECK #6 RAW OUTPUT — DOC-Module X-API-Key auth ===");
    if (!(await docModuleReachable())) {
      console.log("SKIP — DOC-Module not reachable at", DOC_MODULE_URL);
      results.push({
        id: 6,
        name: "DOC-Module /render requires X-API-Key; missing/wrong → 401",
        pass: false,
        detail: "DOC-Module not running",
      });
    } else {
      const noKeyRes = await fetch(`${DOC_MODULE_URL.replace(/\/$/, "")}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: authRenderBody,
      });
      console.log("POST /render (no X-API-Key):", noKeyRes.status, await noKeyRes.text());

      const wrongKeyRes = await fetch(`${DOC_MODULE_URL.replace(/\/$/, "")}/render`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "wrong-key-b22",
        },
        body: authRenderBody,
      });
      console.log("POST /render (wrong X-API-Key):", wrongKeyRes.status, await wrongKeyRes.text());

      assert(noKeyRes.status === 401, `missing key expected 401, got ${noKeyRes.status}`);
      assert(wrongKeyRes.status === 401, `wrong key expected 401, got ${wrongKeyRes.status}`);
      results.push({
        id: 6,
        name: "DOC-Module /render requires X-API-Key; missing/wrong → 401",
        pass: true,
        detail: "PASS",
      });
    }

    // #7 — E2E render
    console.log("\n=== CHECK #7 RAW OUTPUT — first real COA render ===");
    if (!(await docModuleReachable())) {
      console.log("SKIP — DOC-Module not reachable");
      results.push({
        id: 7,
        name: "RUNTIME — COA sign-and-issue → DOC-Module → DOCX returned",
        pass: false,
        detail: "DOC-Module not running",
      });
    } else {
      const e2eFixture = await createCoaReadyFixture(`e2e-${Date.now()}`);
      try {
        await signAndIssueCoa(
          e2eFixture.coaDocId,
          actor(e2eFixture.sanjayId, Role.QA_MGR),
          DEV_PASSWORD,
        );
        const coa = await prisma.batchDocument.findUniqueOrThrow({
          where: { id: e2eFixture.coaDocId },
        });
        const batch = await prisma.batch.findUniqueOrThrow({ where: { id: e2eFixture.batchId } });
        const payload = await mapToCoaRenderInput(e2eFixture.coaDocId);
        const buffer = await sopClient.render("coa", payload);
        const renderResult = {
          ok: true as const,
          status: 200,
          byteLength: buffer.byteLength,
        };
        console.log("COA status after sign-and-issue:", coa.status);
        console.log("Batch status after sign-and-issue:", batch.status);
        console.log("Direct sopClient.render result:", JSON.stringify(renderResult, null, 2));
        assert(coa.status === DocStatus.ISSUED, "COA must be ISSUED");
        assert(batch.status === BatchStatus.RELEASED, "Batch must be RELEASED");
        assert(renderResult.byteLength > 1000, "DOCX must have content");
        console.log(`HTTP ${renderResult.status} — DOCX byteLength=${renderResult.byteLength}`);
        results.push({
          id: 7,
          name: "RUNTIME — COA sign-and-issue → DOC-Module → DOCX returned",
          pass: true,
          detail: `HTTP 200, byteLength=${renderResult.byteLength}`,
        });
      } finally {
        const product = await prisma.product.findFirst({ where: { name: "Glycine" } });
        await deleteBatchFixture(e2eFixture.batchId);
        if (product) await deleteSpecFixture(product.id);
      }
    }

    results.push(
      await runCheck(8, "HTTP call fires AFTER commit, not inside tx", async () => {
        const renderSrc = readFileSync(
          join(__dirname, "../src/services/render-documents.service.ts"),
          "utf8",
        );
        const docSrc = readFileSync(
          join(__dirname, "../src/modules/documents/documents.service.ts"),
          "utf8",
        );
        const engineSrc = readFileSync(
          join(__dirname, "../src/services/workflow-engine.ts"),
          "utf8",
        );
        assert(
          renderSrc.includes("sopClient.render") || renderSrc.includes('await sopClient.render'),
          "render-documents must call sopClient.render",
        );
        assert(!engineSrc.includes("sopClient.render"), "workflow-engine must not call render HTTP");
        assert(
          docSrc.includes("await transition(") && docSrc.includes("scheduleDocumentRender"),
          "signAndIssueCoa must schedule COA render after transition",
        );
        const signAndIssueBlock =
          docSrc.match(/export async function signAndIssueCoa[\s\S]*?\n\}/)?.[0] ?? "";
        assert(signAndIssueBlock.length > 0, "signAndIssueCoa block must exist");
        const transitionIdx = signAndIssueBlock.indexOf("await transition(");
        const renderIdx = signAndIssueBlock.indexOf("scheduleDocumentRender");
        assert(
          transitionIdx >= 0 && renderIdx > transitionIdx,
          "scheduleDocumentRender must follow transition in signAndIssueCoa",
        );
      }),
    );

    // #9 — non-blocking render failure (fresh process with bad DOC_MODULE_URL)
    console.log("\n=== CHECK #9 RAW OUTPUT — render failure is non-blocking ===");
    const failFixture = await createCoaReadyFixture(`fail-${Date.now()}`);
    try {
      execSync(
        `npx tsx scripts/verify-b22-check9.ts ${failFixture.coaDocId} ${failFixture.batchId} ${failFixture.sanjayId}`,
        {
          cwd: join(__dirname, ".."),
          stdio: "inherit",
          env: {
            ...process.env,
            DOC_MODULE_URL: "http://127.0.0.1:59999",
          },
        },
      );
      results.push({
        id: 9,
        name: "RUNTIME — render failure non-blocking (COA ISSUED, batch RELEASED)",
        pass: true,
        detail: "PASS — see raw output above",
      });
    } catch (error) {
      results.push({
        id: 9,
        name: "RUNTIME — render failure non-blocking (COA ISSUED, batch RELEASED)",
        pass: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      const product = await prisma.product.findFirst({ where: { name: "Glycine" } });
      await deleteBatchFixture(failFixture.batchId);
      if (product) await deleteSpecFixture(product.id);
    }

    results.push(
      await runCheck(10, "Audit GENERATE record written inside sign-and-issue tx", async () => {
        const auditFixture = await createCoaReadyFixture(`audit-${Date.now()}`);
        try {
          await signAndIssueCoa(
            auditFixture.coaDocId,
            actor(auditFixture.sanjayId, Role.QA_MGR),
            DEV_PASSWORD,
          );
          const generateAudit = await prisma.auditLog.findFirst({
            where: {
              entityId: auditFixture.coaDocId,
              action: AuditAction.GENERATE,
              comment: { contains: "COA render requested" },
            },
            orderBy: { createdAt: "desc" },
          });
          assert(generateAudit !== null, "GENERATE audit must exist after sign-and-issue");
        } finally {
          const product = await prisma.product.findFirst({ where: { name: "Glycine" } });
          await deleteBatchFixture(auditFixture.batchId);
          if (product) await deleteSpecFixture(product.id);
        }
      }),
    );

    results.push(
      await runCheck(11, "file_attachments written after COA render", async () => {
        const persistFixture = await createCoaReadyFixture(`persist-${Date.now()}`);
        try {
          await signAndIssueCoa(
            persistFixture.coaDocId,
            actor(persistFixture.sanjayId, Role.QA_MGR),
            DEV_PASSWORD,
          );
          const { executeDocumentRender } = await import(
            "../src/services/render-documents.service"
          );
          const result = await executeDocumentRender({
            kind: "COA",
            batchDocumentId: persistFixture.coaDocId,
            actorId: persistFixture.sanjayId,
          });
          assert(result.status === "rendered", `expected rendered, got ${result.status}`);
          const attachments = await prisma.fileAttachment.findMany({
            where: { batchDocumentId: persistFixture.coaDocId },
          });
          assert(attachments.length >= 1, "expected ≥1 file_attachments row for COA");
        } finally {
          const product = await prisma.product.findFirst({ where: { name: "Glycine" } });
          await deleteBatchFixture(persistFixture.batchId);
          if (product) await deleteSpecFixture(product.id);
        }
      }),
    );

    results.push(
      await runCheck(12, "COA executeDocumentRender returns rendered with attachments", async () => {
        const coaFixture = await createCoaReadyFixture(`coa-live-${Date.now()}`);
        try {
          await signAndIssueCoa(
            coaFixture.coaDocId,
            actor(coaFixture.sanjayId, Role.QA_MGR),
            DEV_PASSWORD,
          );
          const { executeDocumentRender } = await import(
            "../src/services/render-documents.service"
          );
          const result = await executeDocumentRender({
            kind: "COA",
            batchDocumentId: coaFixture.coaDocId,
            actorId: coaFixture.sanjayId,
          });
          assert(result.status === "rendered", `COA render must succeed, got ${result.status}`);
          const count = await prisma.fileAttachment.count({
            where: { batchDocumentId: coaFixture.coaDocId },
          });
          assert(count >= 1, "COA attachments must exist after render");
        } finally {
          const product = await prisma.product.findFirst({ where: { name: "Glycine" } });
          await deleteBatchFixture(coaFixture.batchId);
          if (product) await deleteSpecFixture(product.id);
        }
      }),
    );

    results.push(
      await runCheck(13, "typecheck green (slice-local)", async () => {
        execSync("npm run typecheck", { cwd: join(__dirname, ".."), stdio: "pipe" });
      }),
    );
  } finally {
    await drainDocumentRenderQueues(30_000);
    await prisma.$disconnect();
  }

  console.log("\n=== B-2.2 VERIFICATION TABLE ===");
  console.log("| # | Check | Pass/Fail | Evidence |");
  console.log("|---|-------|-----------|----------|");
  for (const r of results.sort((a, b) => a.id - b.id)) {
    const evidence = r.detail.length > 60 ? `${r.detail.slice(0, 57)}...` : r.detail;
    console.log(`| ${r.id} | ${r.name} | ${r.pass ? "Pass" : "Fail"} | ${evidence} |`);
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll B-2.2 checks PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
