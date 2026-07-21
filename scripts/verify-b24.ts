/**
 * Track B / B-2.4 verification — standing SPEC+MOA fan-out, mappers, explorer, decoupled legs.
 *
 * Contract (locked): DOC-Module POST /generate + ProductConfig — NOT sopClient.render for standing docs.
 */
import "dotenv/config";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  FileType,
  RenderStatus,
  Role,
  StandingDocStatus,
} from "@prisma/client";
import { prisma } from "../src/lib/prisma-types";
import { getDocumentExplorerTree } from "../src/modules/documents/explorer.service";
import {
  approveSpec,
  createSpec,
  signSpec,
  submitSpec,
} from "../src/modules/specs/specs.service";
import { mapToMoaRenderInput } from "../src/services/moa-render-mapper";
import { mapToSpecRenderInput } from "../src/services/spec-render-mapper";
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
import { SAMPLE_SPEC_BODY } from "./lib/aws-section-fixture";
import {
  DEV_PASSWORD,
  ensureVerifierActiveMaster,
  ensureVerifierProduct,
  resetVerifierStandingSpecs,
} from "./lib/verifier-harness";

const DOC_MODULE_URL = process.env.DOC_MODULE_URL ?? "http://localhost:8000";
const DOC_MODULE_API_KEY = process.env.DOC_MODULE_API_KEY ?? "";
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

async function deleteStandingFixture(productId: string) {
  await drainDocumentRenderQueues(60_000);
  await prisma.fileAttachment.deleteMany({ where: { spec: { productId } } });
  await resetVerifierStandingSpecs(productId);
}

async function createQaSignedSpec(productId: string, kavyaId: string, priyaId: string, sanjayId: string) {
  await deleteStandingFixture(productId);
  const created = await createSpec(productId, SAMPLE_SPEC_BODY, actor(kavyaId, Role.QC_EXEC));
  await submitSpec(created.id, actor(kavyaId, Role.QC_EXEC));
  await approveSpec(created.id, DEV_PASSWORD, actor(priyaId, Role.QC_MGR));
  await signSpec(created.id, DEV_PASSWORD, actor(sanjayId, Role.QA_MGR));
  const signed = await prisma.spec.findFirst({
    where: { productId, status: StandingDocStatus.QA_SIGNED },
    orderBy: { revisionNo: "desc" },
    include: { moaDoc: true },
  });
  if (!signed?.moaDoc) throw new Error("Failed to obtain QA_SIGNED spec fixture");
  return signed;
}

function validateInlineGenerateWithPython(json: string): void {
  const docModuleRoot = join(__dirname, "../../AC-QMS-DOC-Module");
  const tempDir = mkdtempSync(join(tmpdir(), "b24-standing-"));
  const payloadPath = join(tempDir, "payload.json");
  writeFileSync(payloadPath, json, "utf8");
  const escapedPath = payloadPath.replace(/\\/g, "/");
  const venvPy = join(docModuleRoot, ".venv", "Scripts", "python.exe");
  const py = existsSync(venvPy) ? `"${venvPy}"` : "py -3.13";
  const out = execSync(
    `${py} -c "from app.schemas.document import InlineGenerateRequest; InlineGenerateRequest.model_validate_json(open(r'${escapedPath}').read()); print('VALID')"`,
    {
      cwd: docModuleRoot,
      encoding: "utf8",
      env: { ...process.env, API_KEY: DOC_MODULE_API_KEY || "test" },
    },
  );
  assert(out.trim().includes("VALID"), `Python validation failed: ${out}`);
}

class FailingStorage implements DocumentStorage {
  async save(): Promise<never> {
    throw new Error("Simulated storage failure (B-2.4 #11)");
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

async function main() {
  await drainDocumentRenderQueues(10_000);
  const results: CheckResult[] = [];
  const reachable = await docModuleReachable();

  const kavya = await getUser("kavya.patel");
  const priya = await getUser("priya.mehta");
  const sanjay = await getUser("sanjay.reddy");
  const verifierProduct = await ensureVerifierProduct();
  await ensureVerifierActiveMaster(kavya.id);

  // --- Check 1: contracts (static) ---
  results.push(
    await runCheck(
      1,
      "Standing contracts: POST /generate + ProductConfig; not sopClient.render",
      async () => {
        const renderSrc = readFileSync(
          join(__dirname, "../src/services/render-documents.service.ts"),
          "utf8",
        );
        const standingSrc = readFileSync(
          join(__dirname, "../src/services/sop-mapper/standing-mapper.ts"),
          "utf8",
        );
        assert(renderSrc.includes("sopClient.generate(specReq)"), "SPEC uses sopClient.generate");
        assert(renderSrc.includes("sopClient.generate(moaReq)"), "MOA uses sopClient.generate");
        assert(!renderSrc.includes('sopClient.render("specification"'), "no render for specification");
        assert(!renderSrc.includes('sopClient.render("moa"'), "no render for moa");
        assert(standingSrc.includes("mapToSpecRenderInput"), "mapToSpecRenderInput exported");
        assert(standingSrc.includes("mapToMoaRenderInput"), "mapToMoaRenderInput exported");
        assert(standingSrc.includes('document_type: "specification"'), "specification document_type");
        assert(standingSrc.includes('document_type: "moa"'), "moa document_type");
      },
    ),
  );

  // --- Checks 2–4: mapper ---
  let mapperSpecId: string | null = null;
  try {
    const signed = await createQaSignedSpec(
      verifierProduct.id,
      kavya.id,
      priya.id,
      sanjay.id,
    );
    mapperSpecId = signed.id;
    await drainDocumentRenderQueues(60_000);

    results.push(
      await runCheck(
        2,
        "mapToSpecRenderInput validates against InlineGenerateRequest schema",
        async () => {
          const payload = await mapToSpecRenderInput(mapperSpecId!);
          validateInlineGenerateWithPython(JSON.stringify(payload));
          assert(payload.document_type === "specification", "document_type must be specification");
        },
      ),
    );

    results.push(
      await runCheck(
        3,
        "mapToMoaRenderInput validates; document_no from stored moaNo/specNo",
        async () => {
          const specRow = await prisma.spec.findUniqueOrThrow({
            where: { id: mapperSpecId! },
            include: { moaDoc: true },
          });
          const specPayload = await mapToSpecRenderInput(mapperSpecId!);
          const moaPayload = await mapToMoaRenderInput(mapperSpecId!);
          validateInlineGenerateWithPython(JSON.stringify(moaPayload));
          assert(specPayload.document_no === specRow.specNo, "SPEC document_no from stored specNo");
          assert(moaPayload.document_no === specRow.moaDoc!.moaNo, "MOA document_no from stored moaNo");
          assert(moaPayload.document_type === "moa", "document_type must be moa");
        },
      ),
    );

    results.push(
      await runCheck(
        4,
        "Approval PersonSignatures use formatDisplayDate; signature null",
        async () => {
          const specPayload = await mapToSpecRenderInput(mapperSpecId!);
          const moaPayload = await mapToMoaRenderInput(mapperSpecId!);
          for (const payload of [specPayload, moaPayload]) {
            assert(payload.approval.prepared_by.signature === null, "prepared_by.signature null");
            assert(payload.approval.checked_by.signature === null, "checked_by.signature null");
            assert(payload.approval.approved_by.signature === null, "approved_by.signature null");
            assert(
              payload.approval.approved_by.name !== null,
              "approved_by name populated after QA sign",
            );
          }
          assert(
            specPayload.product.tests.length >= 1,
            "ProductConfig tests populated from spec_tests",
          );
        },
      ),
    );
  } finally {
    if (mapperSpecId) {
      await deleteStandingFixture(verifierProduct.id);
      mapperSpecId = null;
    }
  }

  // --- Check 5: runtime dual generate ---
  console.log("\n=== CHECK #5 RAW OUTPUT — QA sign + drain → two generates succeed ===");
  if (!reachable) {
    console.log("SKIP — DOC-Module not reachable at", DOC_MODULE_URL);
    results.push({
      id: 5,
      name: "RUNTIME — after QA sign + drain, two generates succeed",
      pass: false,
      detail: "DOC-Module not running",
    });
  } else {
    try {
      const signed = await createQaSignedSpec(
        verifierProduct.id,
        kavya.id,
        priya.id,
        sanjay.id,
      );
      await drainDocumentRenderQueues(60_000);

      const attachments = await prisma.fileAttachment.findMany({
        where: { specId: signed.id, fileType: FileType.DOCX },
        orderBy: { createdAt: "desc" },
      });
      assert(attachments.length >= 2, `expected ≥2 DOCX rows, got ${attachments.length}`);

      const storage = getDocumentStorage();
      const specAtt = attachments.find((a) => a.filePath.includes("/SPEC_"));
      const moaAtt = attachments.find((a) => a.filePath.includes("/MOA_"));
      assert(!!specAtt, "SPEC DOCX attachment required");
      assert(!!moaAtt, "MOA DOCX attachment required");

      const specBytes = await storage.read(specAtt.filePath);
      const moaBytes = await storage.read(moaAtt.filePath);
      const raw = {
        specId: signed.id,
        specStatus: signed.status,
        renderStatus: (
          await prisma.spec.findUnique({ where: { id: signed.id }, select: { renderStatus: true } })
        )?.renderStatus,
        spec: {
          attachmentId: specAtt.id,
          filePath: specAtt.filePath,
          byteLength: specBytes.length,
          magic: specBytes.slice(0, 4).toString("hex"),
        },
        moa: {
          attachmentId: moaAtt.id,
          filePath: moaAtt.filePath,
          byteLength: moaBytes.length,
          magic: moaBytes.slice(0, 4).toString("hex"),
        },
      };
      console.log(JSON.stringify(raw, null, 2));
      assert(specBytes.length > 100 && moaBytes.length > 100, "both byteLength > 100");
      assert(specBytes[0] === 0x50 && specBytes[1] === 0x4b, "SPEC PK magic");
      assert(moaBytes[0] === 0x50 && moaBytes[1] === 0x4b, "MOA PK magic");
      results.push({
        id: 5,
        name: "RUNTIME — after QA sign + drain, two generates succeed",
        pass: true,
        detail: `SPEC=${specBytes.length}b MOA=${moaBytes.length}b`,
      });
    } catch (err) {
      results.push({
        id: 5,
        name: "RUNTIME — after QA sign + drain, two generates succeed",
        pass: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      await deleteStandingFixture(verifierProduct.id);
    }
  }

  // --- Check 6: attachment rows ---
  console.log("\n=== CHECK #6 RAW OUTPUT — two attachment rows, same specId, /SPEC_ and /MOA_ ===");
  if (!reachable) {
    results.push({
      id: 6,
      name: "Two attachment rows same specId; paths /SPEC_ and /MOA_",
      pass: false,
      detail: "DOC-Module not running",
    });
  } else {
    try {
      const signed = await createQaSignedSpec(
        verifierProduct.id,
        kavya.id,
        priya.id,
        sanjay.id,
      );
      await drainDocumentRenderQueues(60_000);
      const rows = await prisma.fileAttachment.findMany({
        where: { specId: signed.id, fileType: FileType.DOCX },
        orderBy: { createdAt: "desc" },
      });
      const raw = rows.map((r) => ({
        id: r.id,
        specId: r.specId,
        filePath: r.filePath,
        docNo: r.docNo,
      }));
      console.log(JSON.stringify(raw, null, 2));
      assert(rows.length >= 2, "expected ≥2 DOCX attachments");
      const specRow = rows.find((r) => r.filePath.includes("/SPEC_"));
      const moaRow = rows.find((r) => r.filePath.includes("/MOA_"));
      assert(!!specRow && !!moaRow, "both /SPEC_ and /MOA_ paths required");
      assert(specRow!.specId === signed.id && moaRow!.specId === signed.id, "both link to specId");
      results.push({
        id: 6,
        name: "Two attachment rows same specId; paths /SPEC_ and /MOA_",
        pass: true,
        detail: `specId=${signed.id} SPEC=${specRow!.id} MOA=${moaRow!.id}`,
      });
    } catch (err) {
      results.push({
        id: 6,
        name: "Two attachment rows same specId; paths /SPEC_ and /MOA_",
        pass: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      await deleteStandingFixture(verifierProduct.id);
    }
  }

  // --- Check 7: MOA fail, SPEC persists ---
  console.log("\n=== CHECK #7 RAW OUTPUT — MOA generate fail; SPEC persisted; QA_SIGNED ===");
  if (!reachable) {
    results.push({
      id: 7,
      name: "RUNTIME — MOA fail; SPEC persisted; status QA_SIGNED",
      pass: false,
      detail: "DOC-Module not running",
    });
  } else {
    try {
      execSync(
        `npx tsx scripts/verify-b24-check7.ts ${verifierProduct.id} ${kavya.id} ${priya.id} ${sanjay.id}`,
        {
          cwd: join(__dirname, ".."),
          stdio: "inherit",
          env: {
            ...process.env,
            STANDING_MOA_GENERATE_FAIL: "1",
          },
        },
      );
      results.push({
        id: 7,
        name: "RUNTIME — MOA fail; SPEC persisted; status QA_SIGNED",
        pass: true,
        detail: "PASS — see raw output above",
      });
    } catch (error) {
      results.push({
        id: 7,
        name: "RUNTIME — MOA fail; SPEC persisted; status QA_SIGNED",
        pass: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await deleteStandingFixture(verifierProduct.id);
    }
  }

  // --- Check 8: DOC-Module down ---
  console.log("\n=== CHECK #8 RAW OUTPUT — DOC-Module down; still QA_SIGNED ===");
  {
    try {
      execSync(`npx tsx scripts/verify-b24-check8.ts ${verifierProduct.id}`, {
        cwd: join(__dirname, ".."),
        stdio: "inherit",
        env: {
          ...process.env,
          DOC_MODULE_URL: "http://127.0.0.1:59999",
        },
      });
      results.push({
        id: 8,
        name: "RUNTIME — DOC-Module down; workflow QA_SIGNED unaffected",
        pass: true,
        detail: "PASS — see raw output above",
      });
    } catch (error) {
      results.push({
        id: 8,
        name: "RUNTIME — DOC-Module down; workflow QA_SIGNED unaffected",
        pass: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await deleteStandingFixture(verifierProduct.id);
    }
  }

  // --- Check 9: static post-commit schedule ---
  results.push(
    await runCheck(9, "Static: schedule after $transaction; no generate inside tx", async () => {
      const engineSrc = readFileSync(
        join(__dirname, "../src/services/workflow-engine.ts"),
        "utf8",
      );
      const txEnd = engineSrc.indexOf("await prisma.$transaction(runTransition)");
      const schedSpec = engineSrc.indexOf('kind: "STANDING_SPEC"');
      assert(txEnd > 0 && schedSpec > txEnd, "STANDING_SPEC schedule after transaction");
      assert(!engineSrc.includes("sopClient.generate"), "workflow-engine must not call generate");
    }),
  );

  // --- Check 10: explorer + download ---
  console.log("\n=== CHECK #10 RAW OUTPUT — explorer both hasFile; distinct DOCX bytes ===");
  if (!reachable) {
    results.push({
      id: 10,
      name: "RUNTIME — explorer SPEC+MOA hasFile; download distinct DOCX",
      pass: false,
      detail: "DOC-Module not running",
    });
  } else {
    try {
      const signed = await createQaSignedSpec(
        verifierProduct.id,
        kavya.id,
        priya.id,
        sanjay.id,
      );
      await drainDocumentRenderQueues(60_000);

      const tree = await getDocumentExplorerTree(actor(priya.id, Role.QC_MGR), {
        productId: verifierProduct.id,
      });
      const productNode = tree.products.find((p) => p.id === verifierProduct.id);
      assert(!!productNode?.spec?.hasFile, "SPEC hasFile must be true");
      assert(!!productNode?.moa?.hasFile, "MOA hasFile must be true");
      assert(!!productNode?.spec?.attachmentId, "SPEC attachmentId required");
      assert(!!productNode?.moa?.attachmentId, "MOA attachmentId required");
      assert(
        productNode!.spec!.attachmentId !== productNode!.moa!.attachmentId,
        "SPEC and MOA attachmentIds must differ",
      );

      const token = await apiLogin("priya.mehta");
      const specDl = await fetch(
        `${API_BASE}/documents/attachments/${productNode!.spec!.attachmentId}/download`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const moaDl = await fetch(
        `${API_BASE}/documents/attachments/${productNode!.moa!.attachmentId}/download`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      assert(specDl.ok, `SPEC download HTTP ${specDl.status}`);
      assert(moaDl.ok, `MOA download HTTP ${moaDl.status}`);
      const specBytes = Buffer.from(await specDl.arrayBuffer());
      const moaBytes = Buffer.from(await moaDl.arrayBuffer());
      const raw = {
        spec: {
          attachmentId: productNode!.spec!.attachmentId,
          hasFile: productNode!.spec!.hasFile,
          byteLength: specBytes.length,
          magic: specBytes.slice(0, 4).toString("hex"),
        },
        moa: {
          attachmentId: productNode!.moa!.attachmentId,
          hasFile: productNode!.moa!.hasFile,
          byteLength: moaBytes.length,
          magic: moaBytes.slice(0, 4).toString("hex"),
        },
        bytesDistinct: !specBytes.equals(moaBytes),
      };
      console.log(JSON.stringify(raw, null, 2));
      assert(specBytes.length > 100 && moaBytes.length > 100, "both downloads > 100 bytes");
      assert(!specBytes.equals(moaBytes), "SPEC and MOA bytes must differ");
      results.push({
        id: 10,
        name: "RUNTIME — explorer SPEC+MOA hasFile; download distinct DOCX",
        pass: true,
        detail: `SPEC=${specBytes.length}b MOA=${moaBytes.length}b distinct=${raw.bytesDistinct}`,
      });
    } catch (err) {
      results.push({
        id: 10,
        name: "RUNTIME — explorer SPEC+MOA hasFile; download distinct DOCX",
        pass: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      await deleteStandingFixture(verifierProduct.id);
    }
  }

  // --- Check 11: target_gone warn vs storage ERROR ---
  console.log("\n=== CHECK #11 RAW OUTPUT — target_gone warn vs storage fail ERROR ===");
  if (!reachable) {
    results.push({
      id: 11,
      name: "target_gone warn vs storage fail ERROR",
      pass: false,
      detail: "DOC-Module not running",
    });
  } else {
    try {
      const signed = await createQaSignedSpec(
        verifierProduct.id,
        kavya.id,
        priya.id,
        sanjay.id,
      );
      await drainDocumentRenderQueues(60_000);
      await prisma.fileAttachment.deleteMany({ where: { specId: signed.id } });

      setDocumentStorageForTest(new FailingStorage());
      const renderResult = await executeDocumentRender({
        kind: "STANDING_SPEC",
        specId: signed.id,
        actorId: sanjay.id,
      });
      const after = await prisma.spec.findUniqueOrThrow({ where: { id: signed.id } });
      const attCount = await prisma.fileAttachment.count({ where: { specId: signed.id } });
      console.log("renderResult:", JSON.stringify(renderResult));
      console.log("spec status:", after.status, "renderStatus:", after.renderStatus);
      console.log("attachment count:", attCount);
      assert(after.status === StandingDocStatus.QA_SIGNED, "QA_SIGNED must remain");
      assert(attCount === 0, "no attachments when storage fails");
      assert(
        after.renderStatus === RenderStatus.FAILED,
        "genuine storage failure must mark renderStatus FAILED (ERROR path)",
      );
      console.log("GENUINE_FAILURE_STILL_ERRORS: renderStatus=FAILED (storage)");

      const renderSrc = readFileSync(
        join(__dirname, "../src/services/render-documents.service.ts"),
        "utf8",
      );
      assert(renderSrc.includes("target deleted, skipping"), "target_gone warn path present");
      assert(renderSrc.includes("persist failed"), "persist ERROR path present per leg");

      results.push({
        id: 11,
        name: "target_gone warn vs storage fail ERROR",
        pass: true,
        detail: `renderStatus=${after.renderStatus} attCount=${attCount}`,
      });
    } catch (err) {
      results.push({
        id: 11,
        name: "target_gone warn vs storage fail ERROR",
        pass: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDocumentStorageForTest(null);
      resetDocumentStorageCache();
      await deleteStandingFixture(verifierProduct.id);
    }
  }

  // --- Check 12: AWS/COA render unchanged ---
  results.push(
    await runCheck(
      12,
      "Static: AWS/COA sopClient.render still present (no nested b22/b23)",
      async () => {
        const renderSrc = readFileSync(
          join(__dirname, "../src/services/render-documents.service.ts"),
          "utf8",
        );
        assert(renderSrc.includes('sopClient.render("aws"'), "AWS render path intact");
        assert(renderSrc.includes('sopClient.render("coa"'), "COA render path intact");
        assert(renderSrc.includes("async function renderAws"), "renderAws present");
        assert(renderSrc.includes("async function renderCoa"), "renderCoa present");
      },
    ),
  );

  // --- Check 13: typecheck ---
  results.push(
    await runCheck(13, "typecheck green (slice-local)", async () => {
      execSync("npm run typecheck", { cwd: join(__dirname, ".."), stdio: "pipe" });
    }),
  );

  // --- Check 14: verify:all reminder ---
  results.push({
    id: 14,
    name: "Run verify:all separately after green b24",
    pass: true,
    detail: "Manual: npm run verify:all (not nested in verify:b24)",
  });

  console.log("\n=== B-2.4 VERIFICATION TABLE ===");
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
  console.log("\nAll B-2.4 checks passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
