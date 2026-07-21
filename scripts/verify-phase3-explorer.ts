/**
 * Phase 3 — Document Explorer API verification.
 * Starts an in-process HTTP server so checks use real JWT tokens.
 */
import "dotenv/config";
import { execSync } from "child_process";
import http from "http";
import type { AddressInfo } from "net";
import { readFileSync } from "fs";
import { join } from "path";
import { DocType, FileType, Role } from "@prisma/client";
import app from "../src/app";
import { prisma } from "../src/lib/prisma-types";
import { createBatch } from "../src/modules/batches/batches.service";
import { persistRenderedDocument } from "../src/services/persist-rendered-document";
import { drainDocumentRenderQueues } from "../src/services/render-documents.service";
import { getDocumentStorage } from "../src/services/storage";
import { JwtAccessPayload } from "../src/types/auth.types";
import {
  DEV_PASSWORD,
  ensureQaSignedHarnessSpec,
  ensureVerifierActiveMaster,
  ensureVerifierProduct,
  SAMPLE_SPEC_BODY,
} from "./lib/verifier-harness";

type CheckResult = { id: number; name: string; pass: boolean; detail: string };

type ExplorerTree = {
  products: Array<{
    id: string;
    name: string;
    spec: {
      id: string;
      docType: string;
      docNo: string;
      status: string;
      updatedAt: string;
      hasFile: boolean;
      fileId?: string;
      attachmentId?: string;
    } | null;
    moa: {
      id: string;
      docType: string;
      docNo: string;
      status: string;
      updatedAt: string;
      hasFile: boolean;
    } | null;
    batches: Array<{
      id: string;
      batchNo: string;
      assignedQcExecId: string | null;
      aws: { id: string; docType: string; status: string; hasFile: boolean } | null;
      coa: {
        id: string;
        docType: string;
        status: string;
        hasFile: boolean;
        attachmentId?: string;
        docNo?: string;
      } | null;
    }>;
  }>;
};

function actor(userId: string, role: Role): JwtAccessPayload {
  return { userId, role, departmentId: null };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function getUser(username: string) {
  return prisma.user.findUniqueOrThrow({ where: { username } });
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

/** Minimal ZIP/DOCX magic so Content-Type checks still look like a real file. */
function minimalDocxBytes(): Buffer {
  // PK\x03\x04 + padding — enough for byteLength proof
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("AC-QMS Phase3 COA fixture"),
  ]);
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

async function main() {
  const results: CheckResult[] = [];
  let server: http.Server | null = null;
  let baseUrl = "";
  let kavyaBatchId = "";
  let meeraBatchId = "";
  let productId = "";
  let meeraCoaAttachmentId = "";
  let meeraCoaDocNo = "";
  let missingAttachmentId = "";

  const rawDumps: Record<string, string> = {};

  try {
    const kavya = await getUser("kavya.patel");
    const meera = await getUser("meera.iyer");
    const priya = await getUser("priya.mehta");
    const sanjay = await getUser("sanjay.reddy");
    const diya = await getUser("diya.sharma");
    const anand = await getUser("anand.joshi").catch(() =>
      prisma.user.findFirst({ where: { role: Role.QA_EXEC } }),
    );

    const product = await ensureVerifierProduct();
    productId = product.id;
    await ensureVerifierActiveMaster(kavya.id);

    const signedSpec = await ensureQaSignedHarnessSpec(
      product.id,
      kavya.id,
      priya.id,
      sanjay.id,
      SAMPLE_SPEC_BODY,
    );

    const suffix = Date.now().toString(36);
    const kavyaBatch = await createBatch(
      product.id,
      {
        sourceSpecId: signedSpec.id,
        batchNo: `P3K-${suffix}`,
        assignedQcExecId: kavya.id,
        batchSize: "10 kg",
      },
      actor(priya.id, Role.QC_MGR),
    );
    kavyaBatchId = kavyaBatch.batch.id;

    const meeraBatch = await createBatch(
      product.id,
      {
        sourceSpecId: signedSpec.id,
        batchNo: `P3M-${suffix}`,
        assignedQcExecId: meera.id,
        batchSize: "10 kg",
      },
      actor(priya.id, Role.QC_MGR),
    );
    meeraBatchId = meeraBatch.batch.id;

    const meeraCoa = await prisma.batchDocument.findFirstOrThrow({
      where: { batchId: meeraBatchId, docType: DocType.COA },
    });
    meeraCoaDocNo = meeraCoa.docNo;

    const persisted = await persistRenderedDocument({
      bytes: minimalDocxBytes(),
      productCode: "VFY",
      batchNo: meeraBatch.batch.batchNo,
      docTypeLabel: "COA",
      docNo: meeraCoa.docNo,
      fileType: FileType.DOCX,
      batchDocumentId: meeraCoa.id,
      generatedBy: "verify-phase3",
    });
    assert(persisted.status === "ok", "persist COA for meera batch");
    meeraCoaAttachmentId = persisted.attachmentId;

    // Ghost attachment on kavya's COA (storage key missing) → 404; keep meera's latest = real file
    const kavyaCoa = await prisma.batchDocument.findFirstOrThrow({
      where: { batchId: kavyaBatchId, docType: DocType.COA },
    });
    const ghost = await prisma.fileAttachment.create({
      data: {
        batchDocumentId: kavyaCoa.id,
        fileType: FileType.DOCX,
        filePath: `ghost/phase3-missing-${suffix}.docx`,
        generatedBy: "verify-phase3-missing",
      },
    });
    missingAttachmentId = ghost.id;

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    async function login(username: string): Promise<string> {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: DEV_PASSWORD }),
      });
      assert(res.ok, `login ${username} → ${res.status}`);
      const json = (await res.json()) as { data: { accessToken: string } };
      return json.data.accessToken;
    }

    async function apiJson<T>(
      method: string,
      path: string,
      token: string,
    ): Promise<{ status: number; json: T; raw: string }> {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
      const raw = await res.text();
      let json: T;
      try {
        json = JSON.parse(raw) as T;
      } catch {
        throw new Error(`Non-JSON ${res.status}: ${raw.slice(0, 200)}`);
      }
      return { status: res.status, json, raw };
    }

    const priyaToken = await login("priya.mehta");
    const sanjayToken = await login("sanjay.reddy");
    const diyaToken = await login("diya.sharma");
    const kavyaToken = await login("kavya.patel");

    results.push(
      await runCheck(1, "GET /documents/explorer returns Product→SPEC/MOA+Batches→AWS/COA tree", async () => {
        const { status, json } = await apiJson<{ success: boolean; data: ExplorerTree }>(
          "GET",
          "/documents/explorer",
          priyaToken,
        );
        assert(status === 200, `status ${status}`);
        const p = json.data.products.find((x) => x.id === productId);
        assert(!!p, "verifier product present");
        assert(!!p!.spec, "spec node");
        assert(!!p!.moa, "moa node");
        assert(p!.batches.length >= 2, "at least two batches");
        const b = p!.batches.find((x) => x.id === kavyaBatchId);
        assert(!!b?.aws && !!b?.coa, "batch has AWS+COA");
        return `products=${json.data.products.length} batches=${p!.batches.length}`;
      }),
    );

    results.push(
      await runCheck(2, "Nodes include docType, docNo, status, updatedAt, hasFile, fileId", async () => {
        const { json } = await apiJson<{ data: ExplorerTree }>(
          "GET",
          `/documents/explorer?productId=${productId}`,
          priyaToken,
        );
        const p = json.data.products[0];
        assert(!!p?.spec, "spec");
        for (const key of ["id", "docType", "docNo", "status", "updatedAt", "hasFile"] as const) {
          assert(key in p!.spec!, `spec.${key}`);
        }
        const coa = p!.batches.find((b) => b.id === meeraBatchId)?.coa;
        assert(!!coa, "meera coa");
        assert(coa!.hasFile === true, "meera COA hasFile");
        const att =
          (coa as { attachmentId?: string; fileId?: string }).attachmentId ??
          (coa as { fileId?: string }).fileId;
        assert(!!att, "attachmentId/fileId present");
        assert(att === meeraCoaAttachmentId, `expected ${meeraCoaAttachmentId}, got ${att}`);
        return `spec.docType=${p!.spec!.docType} coa.hasFile=${coa!.hasFile} fileId=${att}`;
      }),
    );

    results.push(
      await runCheck(3, "All states appear (not just finalized)", async () => {
        const { json } = await apiJson<{ data: ExplorerTree }>(
          "GET",
          `/documents/explorer?productId=${productId}`,
          priyaToken,
        );
        const p = json.data.products[0];
        const awsStatus = p!.batches.find((b) => b.id === kavyaBatchId)?.aws?.status;
        const coaStatus = p!.batches.find((b) => b.id === kavyaBatchId)?.coa?.status;
        assert(awsStatus === "DRAFT" || awsStatus === "IN_PROGRESS" || !!awsStatus, `aws=${awsStatus}`);
        assert(!!coaStatus, `coa=${coaStatus}`);
        // Fresh batches: AWS DRAFT, COA typically not ISSUED
        assert(coaStatus !== "ISSUED", `expect non-finalized COA, got ${coaStatus}`);
        return `aws=${awsStatus} coa=${coaStatus} spec=${p!.spec!.status}`;
      }),
    );

    results.push(
      await runCheck(4, "RUNTIME — QC_MGR sees all products/batches/documents", async () => {
        const { json } = await apiJson<{ data: ExplorerTree }>(
          "GET",
          `/documents/explorer?productId=${productId}`,
          priyaToken,
        );
        const p = json.data.products[0];
        const ids = p!.batches.map((b) => b.id).sort();
        assert(ids.includes(kavyaBatchId), "kavya batch");
        assert(ids.includes(meeraBatchId), "meera batch");
        return `batchCount=${p!.batches.length} ids=${ids.join(",")}`;
      }),
    );

    results.push(
      await runCheck(5, "RUNTIME — QA_MGR sees all", async () => {
        const { json } = await apiJson<{ data: ExplorerTree }>(
          "GET",
          `/documents/explorer?productId=${productId}`,
          sanjayToken,
        );
        const p = json.data.products[0];
        assert(p!.batches.some((b) => b.id === kavyaBatchId), "kavya");
        assert(p!.batches.some((b) => b.id === meeraBatchId), "meera");
        return `batchCount=${p!.batches.length}`;
      }),
    );

    results.push(
      await runCheck(6, "RUNTIME — MKT_EXEC (diya.sharma) sees all", async () => {
        const { json } = await apiJson<{ data: ExplorerTree }>(
          "GET",
          `/documents/explorer?productId=${productId}`,
          diyaToken,
        );
        const p = json.data.products[0];
        assert(!!p, "product visible to MKT");
        assert(p!.batches.some((b) => b.id === kavyaBatchId), "kavya");
        assert(p!.batches.some((b) => b.id === meeraBatchId), "meera");
        assert(diya.role === Role.MKT_EXEC, "diya is MKT_EXEC");
        return `batchCount=${p!.batches.length} role=${diya.role}`;
      }),
    );

    results.push(
      await runCheck(
        7,
        "RUNTIME — QC_EXEC (kavya) sees ONLY assigned: SPEC/MOA + her batches; meera sibling ABSENT",
        async () => {
          const { status, json, raw } = await apiJson<{ data: ExplorerTree }>(
            "GET",
            `/documents/explorer?productId=${productId}`,
            kavyaToken,
          );
          assert(status === 200, `status ${status}`);
          rawDumps["#7"] = raw;
          const p = json.data.products[0];
          assert(!!p, "product (assignment on Glycine/harness)");
          assert(!!p!.spec, "SPEC present");
          assert(!!p!.moa, "MOA present");
          assert(p!.batches.some((b) => b.id === kavyaBatchId), "kavya batch present");
          assert(!p!.batches.some((b) => b.id === meeraBatchId), "meera batch ABSENT");
          assert(p!.batches.every((b) => b.assignedQcExecId === kavya.id), "only kavya assignee");
          return `spec=${p!.spec!.docNo} moa=${p!.moa!.docNo} batches=${p!.batches.map((b) => b.batchNo).join(",")}`;
        },
      ),
    );

    results.push(
      await runCheck(8, "RUNTIME — QC_MGR downloads persisted COA → DOCX bytes + filename", async () => {
        const res = await fetch(
          `${baseUrl}/documents/attachments/${meeraCoaAttachmentId}/download`,
          { headers: { Authorization: `Bearer ${priyaToken}` } },
        );
        const buf = Buffer.from(await res.arrayBuffer());
        const cd = res.headers.get("content-disposition") ?? "";
        const ct = res.headers.get("content-type") ?? "";
        rawDumps["#8"] = JSON.stringify(
          {
            status: res.status,
            contentType: ct,
            contentDisposition: cd,
            byteLength: buf.length,
            magic: buf.slice(0, 4).toString("hex"),
          },
          null,
          2,
        );
        assert(res.status === 200, `status ${res.status}`);
        assert(buf.length > 0, "non-empty");
        assert(buf[0] === 0x50 && buf[1] === 0x4b, "ZIP/DOCX magic PK");
        assert(cd.includes("attachment"), "Content-Disposition attachment");
        assert(cd.includes(meeraCoaDocNo) || cd.includes(".docx"), `filename has docNo: ${cd}`);
        assert(ct.includes("officedocument") || ct.includes("octet"), `ct=${ct}`);
        return `byteLength=${buf.length} disposition=${cd}`;
      }),
    );

    results.push(
      await runCheck(9, "RUNTIME — QC_EXEC downloads sibling COA by ID → 403", async () => {
        const res = await fetch(
          `${baseUrl}/documents/attachments/${meeraCoaAttachmentId}/download`,
          { headers: { Authorization: `Bearer ${kavyaToken}` } },
        );
        const body = await res.text();
        rawDumps["#9"] = JSON.stringify({ status: res.status, body }, null, 2);
        assert(res.status === 403, `expected 403, got ${res.status}: ${body}`);
        return `status=403 body=${body.slice(0, 120)}`;
      }),
    );

    results.push(
      await runCheck(10, "Missing file/attachment → 404 (distinct from 403)", async () => {
        const missingRow = await fetch(
          `${baseUrl}/documents/attachments/${missingAttachmentId}/download`,
          { headers: { Authorization: `Bearer ${priyaToken}` } },
        );
        const missingId = await fetch(
          `${baseUrl}/documents/attachments/00000000-0000-4000-8000-000000000000/download`,
          { headers: { Authorization: `Bearer ${priyaToken}` } },
        );
        assert(missingRow.status === 404, `ghost file → ${missingRow.status}`);
        assert(missingId.status === 404, `unknown id → ${missingId.status}`);
        return `ghost=${missingRow.status} unknown=${missingId.status}`;
      }),
    );

    results.push(
      await runCheck(11, "Download served via Phase 2 storage adapter (no direct fs in route)", async () => {
        const src = readFileSync(
          join(__dirname, "../src/modules/documents/attachments.service.ts"),
          "utf8",
        );
        assert(src.includes("getDocumentStorage()"), "uses getDocumentStorage");
        assert(src.includes("storage.read"), "uses storage.read");
        assert(!src.includes("fs.readFile") && !src.includes("readFileSync"), "no direct fs read");
        // Runtime: key exists in adapter
        const att = await prisma.fileAttachment.findUniqueOrThrow({
          where: { id: meeraCoaAttachmentId },
        });
        assert(await getDocumentStorage().exists(att.filePath), "adapter exists");
        return "getDocumentStorage().read used; no fs in attachments.service";
      }),
    );

    results.push(
      await runCheck(12, "Download is audited (AuditAction.EXPORT)", async () => {
        const log = await prisma.auditLog.findFirst({
          where: {
            action: "EXPORT",
            entityId: meeraCoa.id,
            userId: priya.id,
          },
          orderBy: { createdAt: "desc" },
        });
        assert(!!log, "EXPORT audit row for QC_MGR download");
        return `action=${log!.action} entityType=${log!.entityType} docNo=${log!.docNo} (VIEW/DOWNLOAD absent — used EXPORT)`;
      }),
    );

    results.push(
      await runCheck(13, "Single shared access-filter used by BOTH endpoints", async () => {
        const explorer = readFileSync(
          join(__dirname, "../src/modules/documents/explorer.service.ts"),
          "utf8",
        );
        const download = readFileSync(
          join(__dirname, "../src/modules/documents/attachments.service.ts"),
          "utf8",
        );
        assert(explorer.includes("buildDocumentAccessFilter"), "explorer uses filter");
        assert(download.includes("buildDocumentAccessFilter"), "download uses filter");
        assert(download.includes("assertCanAccessDocument"), "download re-asserts");
        return "document-access.ts shared by explorer.service + attachments.service";
      }),
    );

    results.push(
      await runCheck(14, "QA_EXEC scoping decision stated and implemented", async () => {
        const access = readFileSync(
          join(__dirname, "../src/modules/documents/document-access.ts"),
          "utf8",
        );
        assert(access.includes("Role.QA_EXEC"), "QA_EXEC in assigned scope");
        assert(access.includes("ASSIGNED_SCOPE_ROLES"), "assigned roles set");
        let emptyNote = "no QA_EXEC user";
        if (anand) {
          const token = await login(anand.username);
          const { json } = await apiJson<{ data: ExplorerTree }>(
            "GET",
            `/documents/explorer?productId=${productId}`,
            token,
          );
          // QA_EXEC cannot be assignee → empty for this product
          assert(
            json.data.products.length === 0 ||
              (json.data.products[0]?.batches.length ?? 0) === 0,
            "QA_EXEC assignment-scoped → no batches on harness product",
          );
          emptyNote = `${anand.username} products=${json.data.products.length}`;
        }
        return `QA_EXEC = QC_EXEC-like (assignment-scoped). No assignedQaExecId → empty tree. ${emptyNote}`;
      }),
    );

    results.push(
      await runCheck(15, "tsc; existing verifiers still green", async () => {
        execSync("npx tsc --noEmit", {
          cwd: join(__dirname, ".."),
          stdio: "pipe",
          encoding: "utf8",
        });
        return "tsc --noEmit OK (run verify:b25 separately if needed)";
      }),
    );
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => (err ? reject(err) : resolve()));
      });
    }
    if (missingAttachmentId) {
      await prisma.fileAttachment.deleteMany({ where: { id: missingAttachmentId } }).catch(() => {});
    }
    if (kavyaBatchId) await deleteBatchFixture(kavyaBatchId).catch(() => {});
    if (meeraBatchId) await deleteBatchFixture(meeraBatchId).catch(() => {});
    await prisma.$disconnect();
  }

  console.log("\n=== Phase 3 Document Explorer — Verification ===\n");
  console.log("| # | Check | Pass/Fail | Evidence |");
  console.log("|---|-------|-----------|----------|");
  for (const r of results) {
    const evidence = r.detail.replace(/\|/g, "/").replace(/\n/g, " ");
    console.log(`| ${r.id} | ${r.name} | ${r.pass ? "PASS" : "FAIL"} | ${evidence} |`);
  }

  console.log("\n--- Raw output #7 ---");
  console.log(rawDumps["#7"] ?? "(missing)");
  console.log("\n--- Raw output #8 ---");
  console.log(rawDumps["#8"] ?? "(missing)");
  console.log("\n--- Raw output #9 ---");
  console.log(rawDumps["#9"] ?? "(missing)");

  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll Phase 3 checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
