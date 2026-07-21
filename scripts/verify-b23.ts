/**
 * Track B / B-2.3 verification — AWS mapper, live render, persist, explorer integration.
 */
import "dotenv/config";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  DocStatus,
  DocType,
  RenderStatus,
  Role,
} from "@prisma/client";
import { prisma } from "../src/lib/prisma-types";
import {
  approveBatch,
  createBatch,
  submitBatch,
} from "../src/modules/batches/batches.service";
import { transitionDocument } from "../src/modules/documents/documents.service";
import { mapToAwsRenderInput } from "../src/services/aws-render-mapper";
import {
  drainDocumentRenderQueues,
  executeDocumentRender,
} from "../src/services/render-documents.service";
import {
  getDocumentStorage,
  resetDocumentStorageCache,
  setDocumentStorageForTest,
  type DocumentStorage,
} from "../src/services/storage";
import { JwtAccessPayload } from "../src/types/auth.types";
import {
  EXPIRY_ACK_COMMENT,
  OOS_ACK_COMMENT,
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
const API_BASE = process.env.API_BASE_URL ?? "http://localhost:4000/api/v1";
const PASSWORD = process.env.VERIFY_SEED_PASSWORD ?? DEV_PASSWORD;

type CheckResult = { id: number; name: string; pass: boolean; detail: string };

function actor(userId: string, role: Role, departmentId: string | null = null): JwtAccessPayload {
  return { userId, role, departmentId };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function runCheck(
  id: number,
  name: string,
  fn: () => void | Promise<void>,
): Promise<CheckResult> {
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

/** Fill AWS sections (Assay OOS+ack, Description expiry-ack) and workflow through QC_APPROVED. */
async function createAwsApprovedFixture(batchNoSuffix: string) {
  const verifierProduct = await ensureVerifierProduct();
  await ensureVerifierActiveMaster((await getUser("kavya.patel")).id);

  const kavya = await getUser("kavya.patel");
  const meera = await getUser("meera.iyer");
  const priya = await getUser("priya.mehta");
  const sanjay = await getUser("sanjay.reddy");

  const batchNo = `B23-${batchNoSuffix}`;
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

  const { instrumentId } = await fillAndCompleteAllSections({
    sections: sections.map((s) => ({
      id: s.id,
      testName: s.specDocumentTest.testName,
    })),
    analystId: kavya.id,
    checkerId: meera.id,
    assayOos: true,
    descriptionExpiryAck: true,
  });

  await transitionDocument(awsDoc.id, "SUBMIT", actor(kavya.id, Role.QC_EXEC), DEV_PASSWORD);
  await transitionDocument(awsDoc.id, "APPROVE", actor(priya.id, Role.QC_MGR), DEV_PASSWORD);

  const awsAfter = await prisma.batchDocument.findUniqueOrThrow({ where: { id: awsDoc.id } });
  assert(awsAfter.status === DocStatus.QC_APPROVED, "AWS must be QC_APPROVED before sign");

  return {
    productId: verifierProduct.id,
    batchId: created.batch.id,
    batchNo,
    awsDocId: awsDoc.id,
    kavyaId: kavya.id,
    priyaId: priya.id,
    sanjayId: sanjay.id,
    instrumentId,
  };
}

/** AWS QA-signed + COA auto-generated; drains post-commit render queue when DOC-Module up. */
async function createAwsSignedFixture(batchNoSuffix: string) {
  const fixture = await createAwsApprovedFixture(batchNoSuffix);
  await transitionDocument(
    fixture.awsDocId,
    "SIGN",
    actor(fixture.sanjayId, Role.QA_MGR),
    DEV_PASSWORD,
  );
  await drainDocumentRenderQueues(60_000);

  const aws = await prisma.batchDocument.findUniqueOrThrow({ where: { id: fixture.awsDocId } });
  const coa = await prisma.batchDocument.findFirstOrThrow({
    where: { batchId: fixture.batchId, docType: DocType.COA },
  });
  assert(aws.status === DocStatus.QA_SIGNED, "AWS must be QA_SIGNED");
  assert(coa.status === DocStatus.AUTO_GENERATED, "COA must be AUTO_GENERATED");

  return { ...fixture, coaDocId: coa.id };
}

function validateAwsPayloadWithPython(json: string): void {
  const docModuleRoot = join(__dirname, "../../AC-QMS-DOC-Module");
  const tempDir = mkdtempSync(join(tmpdir(), "b23-aws-"));
  const payloadPath = join(tempDir, "payload.json");
  writeFileSync(payloadPath, json, "utf8");
  const escapedPath = payloadPath.replace(/\\/g, "/");
  const venvPy = join(docModuleRoot, ".venv", "Scripts", "python.exe");
  const py = existsSync(venvPy) ? `"${venvPy}"` : "python";
  const pyCmd = `${py} -c "from app.schemas.aws_render import AwsRenderInput; AwsRenderInput.model_validate_json(open(r'${escapedPath}').read()); print('VALID')"`;
  const out = execSync(pyCmd, { cwd: docModuleRoot, encoding: "utf8" });
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

async function apiLogin(username: string): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const body = (await res.json()) as { data?: { accessToken?: string } };
  const token = body?.data?.accessToken;
  if (!res.ok || !token) throw new Error(`Login failed for ${username}: ${res.status}`);
  return token;
}

class FailingStorage implements DocumentStorage {
  async save(): Promise<never> {
    throw new Error("Simulated storage failure (B-2.3 #8)");
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
  await drainDocumentRenderQueues(10_000);
  const results: CheckResult[] = [];
  const reachable = await docModuleReachable();

  // --- Mapper checks (fixture signed so approval lineage populated) ---
  let mapperFixture: Awaited<ReturnType<typeof createAwsSignedFixture>> | null = null;
  try {
    mapperFixture = await createAwsSignedFixture(`mapper-${Date.now()}`);

    results.push(
      await runCheck(1, "mapToAwsRenderInput validates against AwsRenderInput schema", async () => {
        const payload = await mapToAwsRenderInput(mapperFixture!.awsDocId);
        validateAwsPayloadWithPython(JSON.stringify(payload));
      }),
    );

    results.push(
      await runCheck(2, "document_no from stored doc_no; 5 batch fields mapped, 5 null", async () => {
        const doc = await prisma.batchDocument.findUniqueOrThrow({
          where: { id: mapperFixture!.awsDocId },
        });
        const payload = await mapToAwsRenderInput(mapperFixture!.awsDocId);
        assert(payload.document_no === doc.docNo, `Expected ${doc.docNo}, got ${payload.document_no}`);
        assert(payload.batch.batch_no.length > 0, "batch_no required");
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
      await runCheck(
        3,
        "Sections in sortOrder with B-2.1 display strings",
        async () => {
          const payload = await mapToAwsRenderInput(mapperFixture!.awsDocId);
          assert(payload.sections.length >= 2, "expected ≥2 sections");
          for (let i = 1; i < payload.sections.length; i++) {
            assert(
              payload.sections[i]!.sort_order >= payload.sections[i - 1]!.sort_order,
              "sections must be sort_order ascending",
            );
          }
          const assay = payload.sections.find((s) => s.test_name === "Assay");
          assert(!!assay?.limits_display, "limits_display required");
          assert(!!assay?.conclusion_display, "conclusion_display required");
          assert(!!assay?.result_display, "result_display required");
        },
      ),
    );

    results.push(
      await runCheck(4, "OOS + expiry ack fields mapped on fixture section", async () => {
        const payload = await mapToAwsRenderInput(mapperFixture!.awsDocId);
        const oosSection = payload.sections.find((s) => s.test_name === "Assay");
        assert(!!oosSection, "Assay section required");
        assert(oosSection!.is_oos === true, "is_oos must be true");
        assert(oosSection!.oos_acknowledged === true, "oos_acknowledged must be true");
        assert(
          oosSection!.oos_ack_comment === OOS_ACK_COMMENT,
          "oos_ack_comment must match fixture",
        );
        const descSection = payload.sections.find((s) => s.test_name === "Description");
        assert(!!descSection, "Description section required");
        assert(descSection!.instrument_expired_ack === true, "instrument_expired_ack must be true");
        assert(
          descSection!.expiry_ack_comment === EXPIRY_ACK_COMMENT ||
            (descSection!.expiry_ack_comment?.includes("Valid ten+") ?? false),
          `expiry_ack_comment must be set, got ${descSection!.expiry_ack_comment}`,
        );
      }),
    );

    results.push(
      await runCheck(
        5,
        "Per-section analyst/checker + document approval PersonSignatures; signature null",
        async () => {
          const payload = await mapToAwsRenderInput(mapperFixture!.awsDocId);
          for (const section of payload.sections) {
            assert(section.analyst.signature === null, "analyst signature null");
            assert(section.checker.signature === null, "checker signature null");
          }
          assert(payload.approval.prepared_by.signature === null, "prepared signature null");
          assert(payload.approval.checked_by.signature === null, "checked signature null");
          assert(payload.approval.approved_by.signature === null, "approved signature null");
          assert(
            payload.approval.approved_by.name !== null,
            "approved_by name set after QA sign",
          );
        },
      ),
    );
  } finally {
    if (mapperFixture) {
      await deleteBatchFixture(mapperFixture.batchId);
      mapperFixture = null;
    }
  }

  // --- #6 runtime render + persist ---
  console.log("\n=== CHECK #6 RAW OUTPUT — AWS QA-sign → DOCX rendered + persisted ===");
  if (!reachable) {
    console.log("SKIP — DOC-Module not reachable at", DOC_MODULE_URL);
    results.push({
      id: 6,
      name: "RUNTIME — AWS QA-sign → real DOCX rendered and persisted",
      pass: false,
      detail: "DOC-Module not running",
    });
  } else {
    const fixture = await createAwsSignedFixture(`render-${Date.now()}`);
    try {
      const aws = await prisma.batchDocument.findUniqueOrThrow({ where: { id: fixture.awsDocId } });
      const attachments = await prisma.fileAttachment.findMany({
        where: { batchDocumentId: fixture.awsDocId, fileType: "DOCX" },
        orderBy: { createdAt: "desc" },
      });
      const docx = attachments[0];
      assert(!!docx, "file_attachments DOCX row required");
      const storage = getDocumentStorage();
      const bytes = await storage.read(docx.filePath);
      const raw = {
        awsStatus: aws.status,
        renderStatus: aws.renderStatus,
        docNo: aws.docNo,
        attachmentId: docx.id,
        filePath: docx.filePath,
        byteLength: bytes.length,
        magic: bytes.slice(0, 4).toString("hex"),
      };
      console.log(JSON.stringify(raw, null, 2));
      assert(bytes.length > 100, "DOCX byteLength must be > 100");
      assert(bytes[0] === 0x50 && bytes[1] === 0x4b, "PK magic required");
      results.push({
        id: 6,
        name: "RUNTIME — AWS QA-sign → real DOCX rendered and persisted",
        pass: true,
        detail: `byteLength=${bytes.length} attachmentId=${docx.id}`,
      });
    } catch (err) {
      results.push({
        id: 6,
        name: "RUNTIME — AWS QA-sign → real DOCX rendered and persisted",
        pass: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      await drainDocumentRenderQueues();
      await deleteBatchFixture(fixture.batchId);
    }
  }

  // --- #7 render failure non-blocking + COA auto-gen ---
  console.log("\n=== CHECK #7 RAW OUTPUT — render failure non-blocking; COA auto-generates ===");
  {
    const failFixture = await createAwsApprovedFixture(`fail-${Date.now()}`);
    try {
      execSync(
        `npx tsx scripts/verify-b23-check7.ts ${failFixture.awsDocId} ${failFixture.batchId} ${failFixture.sanjayId}`,
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
        id: 7,
        name: "RUNTIME — render failure non-blocking; COA still auto-generates",
        pass: true,
        detail: "PASS — see raw output above",
      });
    } catch (error) {
      results.push({
        id: 7,
        name: "RUNTIME — render failure non-blocking; COA still auto-generates",
        pass: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await deleteBatchFixture(failFixture.batchId);
    }
  }

  // --- #8 persistence failure non-blocking ---
  console.log("\n=== CHECK #8 RAW OUTPUT — persistence failure non-blocking ===");
  if (!reachable) {
    results.push({
      id: 8,
      name: "RUNTIME — persistence failure non-blocking",
      pass: false,
      detail: "DOC-Module not running",
    });
  } else {
    const fixture = await createAwsApprovedFixture(`persist-fail-${Date.now()}`);
    try {
      setDocumentStorageForTest(new FailingStorage());
      await transitionDocument(
        fixture.awsDocId,
        "SIGN",
        actor(fixture.sanjayId, Role.QA_MGR),
        DEV_PASSWORD,
      );
      const renderResult = await executeDocumentRender({
        kind: "AWS",
        batchDocumentId: fixture.awsDocId,
        actorId: fixture.sanjayId,
      });
      const aws = await prisma.batchDocument.findUniqueOrThrow({ where: { id: fixture.awsDocId } });
      const coa = await prisma.batchDocument.findFirstOrThrow({
        where: { batchId: fixture.batchId, docType: DocType.COA },
      });
      const attCount = await prisma.fileAttachment.count({
        where: { batchDocumentId: fixture.awsDocId },
      });
      console.log("renderResult:", JSON.stringify(renderResult));
      console.log("AWS status:", aws.status, "renderStatus:", aws.renderStatus);
      console.log("COA status:", coa.status);
      console.log("attachment count:", attCount);
      assert(aws.status === DocStatus.QA_SIGNED, "AWS must remain QA_SIGNED");
      assert(coa.status === DocStatus.AUTO_GENERATED, "COA must remain AUTO_GENERATED");
      assert(renderResult.status === "rendered", "persist fail must not report render_failed");
      assert(attCount === 0, "no attachments when storage fails");
      assert(
        aws.renderStatus === RenderStatus.FAILED,
        "genuine storage failure must mark renderStatus FAILED (ERROR path)",
      );
      console.log("GENUINE_FAILURE_STILL_ERRORS: renderStatus=FAILED (storage)");
      results.push({
        id: 8,
        name: "RUNTIME — persistence failure non-blocking",
        pass: true,
        detail: `AWS=${aws.status} COA=${coa.status} renderStatus=${aws.renderStatus} (ERROR kept)`,
      });
    } catch (err) {
      results.push({
        id: 8,
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

  // --- #9 explorer hasFile + download ---
  console.log("\n=== CHECK #9 RAW OUTPUT — explorer AWS hasFile + download DOCX ===");
  if (!reachable) {
    results.push({
      id: 9,
      name: "RUNTIME — explorer AWS hasFile true; download returns DOCX",
      pass: false,
      detail: "DOC-Module not running",
    });
  } else {
    const fixture = await createAwsSignedFixture(`explorer-${Date.now()}`);
    try {
      const token = await apiLogin("priya.mehta");
      const treeRes = await fetch(
        `${API_BASE}/documents/explorer?productId=${fixture.productId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      assert(treeRes.ok, `explorer HTTP ${treeRes.status}`);
      const treeJson = (await treeRes.json()) as {
        data?: {
          products: Array<{
            id: string;
            batches: Array<{
              id: string;
              aws: { hasFile: boolean; attachmentId?: string; fileId?: string } | null;
            }>;
          }>;
        };
      };
      const product = treeJson.data?.products.find((p) => p.id === fixture.productId);
      assert(!!product, "product in explorer");
      const batch = product!.batches.find((b) => b.id === fixture.batchId);
      assert(!!batch?.aws, "AWS node required");
      assert(batch!.aws!.hasFile === true, "AWS hasFile must be true");
      const attId = batch!.aws!.attachmentId ?? batch!.aws!.fileId;
      assert(!!attId, "explorer attachmentId required");

      const attRow = await prisma.fileAttachment.findUniqueOrThrow({ where: { id: attId } });
      assert(attRow.fileType === "DOCX", `explorer must expose DOCX attachment, got ${attRow.fileType}`);

      const dl = await fetch(`${API_BASE}/documents/attachments/${attId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const buf = Buffer.from(await dl.arrayBuffer());
      const cd = dl.headers.get("content-disposition") ?? "";
      const filenameMatch = cd.match(/filename="([^"]+)"/i);
      const filename = filenameMatch?.[1] ?? "(none)";
      const raw = {
        explorerStatus: treeRes.status,
        hasFile: batch!.aws!.hasFile,
        downloadStatus: dl.status,
        byteLength: buf.length,
        filename,
        contentDisposition: cd,
        magic: buf.slice(0, 4).toString("hex"),
      };
      console.log(JSON.stringify(raw, null, 2));
      assert(dl.status === 200, "download HTTP 200");
      assert(buf.length > 0, "download body non-empty");
      assert(buf[0] === 0x50 && buf[1] === 0x4b, "DOCX PK magic");
      results.push({
        id: 9,
        name: "RUNTIME — explorer AWS hasFile true; download returns DOCX",
        pass: true,
        detail: `filename=${filename} byteLength=${buf.length}`,
      });
    } catch (err) {
      results.push({
        id: 9,
        name: "RUNTIME — explorer AWS hasFile true; download returns DOCX",
        pass: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      await drainDocumentRenderQueues();
      await deleteBatchFixture(fixture.batchId);
    }
  }

  // --- Static checks 10–12 ---
  results.push(
    await runCheck(10, "AWS render fires AFTER commit; no postRender in tx", async () => {
      const engineSrc = readFileSync(
        join(__dirname, "../src/services/workflow-engine.ts"),
        "utf8",
      );
      const renderSrc = readFileSync(
        join(__dirname, "../src/services/render-documents.service.ts"),
        "utf8",
      );
      assert(renderSrc.includes("sopClient.render"), "render-documents calls sopClient.render");
      assert(!engineSrc.includes("postRender"), "workflow-engine must not call postRender");
      const txEnd = engineSrc.indexOf("await prisma.$transaction(runTransition)");
      const schedAws = engineSrc.indexOf('kind: "AWS"');
      assert(txEnd > 0 && schedAws > txEnd, "scheduleDocumentRender(AWS) after transaction");
    }),
  );

  results.push(
    await runCheck(11, "COA render/persist path unaffected (in-slice static)", async () => {
      const docSrc = readFileSync(
        join(__dirname, "../src/modules/documents/documents.service.ts"),
        "utf8",
      );
      const renderSrc = readFileSync(
        join(__dirname, "../src/services/render-documents.service.ts"),
        "utf8",
      );
      assert(docSrc.includes('kind: "COA"'), "signAndIssueCoa schedules COA render");
      assert(renderSrc.includes('sopClient.render("coa"'), "renderCoa uses sopClient.render");
      assert(renderSrc.includes("async function renderCoa"), "renderCoa present");
    }),
  );

  results.push(
    await runCheck(
      12,
      "STANDING_SPEC fan-out unchanged (B-2.4 scope); renderStandingSpec present",
      async () => {
        const renderSrc = readFileSync(
          join(__dirname, "../src/services/render-documents.service.ts"),
          "utf8",
        );
        const engineSrc = readFileSync(
          join(__dirname, "../src/services/workflow-engine.ts"),
          "utf8",
        );
        assert(renderSrc.includes("async function renderStandingSpec"), "standing render exists");
        assert(engineSrc.includes('kind: "STANDING_SPEC"'), "spec sign still schedules standing");
        const awsMapper = readFileSync(
          join(__dirname, "../src/services/sop-mapper/aws-mapper.ts"),
          "utf8",
        );
        assert(!awsMapper.includes("renderStandingSpec"), "AWS mapper does not touch standing");
      },
    ),
  );

  results.push(
    await runCheck(13, "typecheck green (slice-local)", async () => {
      execSync("npm run typecheck", { cwd: join(__dirname, ".."), stdio: "pipe" });
    }),
  );

  console.log("\n=== B-2.3 VERIFICATION TABLE ===");
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
  console.log("\nALL CHECKS PASSED");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  setDocumentStorageForTest(null);
  resetDocumentStorageCache();
  await prisma.$disconnect();
  process.exit(1);
});
