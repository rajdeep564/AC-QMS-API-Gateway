/**
 * Epic 15 integration verification — requires seed + dev server on :4000 + DOC-Module for PDF fixture
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import {
  BatchStatus,
  DeptName,
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
import { executeDocumentRender } from "../src/services/render-documents.service";
import { AuditAction, AuditEntityType } from "../src/services/audit.service";
import { JwtAccessPayload } from "../src/types/auth.types";
import {
  DEV_PASSWORD,
  ensureQaSignedHarnessSpec,
  ensureVerifierActiveMaster,
  ensureVerifierProduct,
} from "./lib/verifier-harness";
import { fillAndCompleteAllSections, SAMPLE_SPEC_BODY } from "./lib/aws-section-fixture";

const BASE = "http://localhost:4000/api/v1";
const PASSWORD = "Acqms@2026";
const DOC_MODULE_URL = process.env.DOC_MODULE_URL ?? "http://localhost:8000";

type MarketingFixture = {
  releasedBatch: {
    id: string;
    batchNo: string;
    productId: string;
    sourceSpecId: string;
  };
  issuedCoa: { id: string; docNo: string };
};

function actor(userId: string, role: Role, departmentId: string | null = null): JwtAccessPayload {
  return { userId, role, departmentId };
}

async function login(username: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed for ${username}`);
  const json = (await res.json()) as { data: { accessToken: string } };
  return json.data.accessToken;
}

async function api<T>(
  method: string,
  path: string,
  token: string,
  body?: object,
): Promise<{ ok: boolean; status: number; data?: T; body?: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body: text };
  return { ok: true, status: res.status, data: JSON.parse(text) as T };
}

async function downloadRaw(path: string, token: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  return {
    ok: res.ok,
    status: res.status,
    contentType: res.headers.get("content-type"),
    bytes,
  };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
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

async function getUser(username: string) {
  return prisma.user.findUniqueOrThrow({ where: { username } });
}

async function createMarketingCoaFixture(suffix: string): Promise<MarketingFixture> {
  const verifierProduct = await ensureVerifierProduct();
  await ensureVerifierActiveMaster((await getUser("kavya.patel")).id);

  const kavya = await getUser("kavya.patel");
  const meera = await getUser("meera.iyer");
  const priya = await getUser("priya.mehta");
  const sanjay = await getUser("sanjay.reddy");

  const batchNo = `MKT15-${suffix}`;
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
  assert(coaDoc.status === DocStatus.AUTO_GENERATED, "COA must be AUTO_GENERATED before issue");

  await signAndIssueCoa(coaDoc.id, actor(sanjay.id, Role.QA_MGR), DEV_PASSWORD);

  const renderResult = await executeDocumentRender({
    kind: "COA",
    batchDocumentId: coaDoc.id,
    actorId: sanjay.id,
  });
  assert(renderResult.status === "rendered", `COA render failed: ${renderResult.status}`);

  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: created.batch.id } });
  const coa = await prisma.batchDocument.findUniqueOrThrow({ where: { id: coaDoc.id } });
  assert(batch.status === BatchStatus.RELEASED, "batch must be RELEASED");
  assert(coa.status === DocStatus.ISSUED, "COA must be ISSUED");

  const pdf = await prisma.fileAttachment.findFirst({
    where: { batchDocumentId: coa.id, fileType: FileType.PDF },
  });
  assert(pdf != null, "PDF attachment must exist after render");

  return {
    releasedBatch: {
      id: batch.id,
      batchNo: batch.batchNo,
      productId: batch.productId,
      sourceSpecId: batch.sourceSpecId,
    },
    issuedCoa: { id: coa.id, docNo: coa.docNo },
  };
}

async function ensureMarketingReleasedCoaWithPdf(): Promise<MarketingFixture> {
  const existing = await prisma.batchDocument.findFirst({
    where: {
      docType: DocType.COA,
      status: DocStatus.ISSUED,
      batch: { status: BatchStatus.RELEASED },
      attachments: { some: { fileType: FileType.PDF } },
    },
    include: { batch: true },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    console.log(`  Using existing marketing fixture: batch ${existing.batch.batchNo}, COA ${existing.docNo}`);
    return {
      releasedBatch: {
        id: existing.batch.id,
        batchNo: existing.batch.batchNo,
        productId: existing.batch.productId,
        sourceSpecId: existing.batch.sourceSpecId,
      },
      issuedCoa: { id: existing.id, docNo: existing.docNo },
    };
  }

  if (!(await docModuleReachable())) {
    throw new Error(
      "No RELEASED/ISSUED COA with PDF found and DOC-Module unreachable — start DOC-Module on :8000",
    );
  }

  console.log("  Creating marketing COA fixture (RELEASED + ISSUED + PDF)...");
  return createMarketingCoaFixture(String(Date.now()));
}

async function main() {
  console.log("Epic 15 verification starting...\n");

  // Check 1: seed fixtures
  console.log("Check 1: Diya (MKT_EXEC) and Marketing dept color...");
  const diya = await prisma.user.findUniqueOrThrow({ where: { username: "diya.sharma" } });
  assert(diya.role === "MKT_EXEC", "Diya is MKT_EXEC");
  const marketingDept = await prisma.department.findUniqueOrThrow({
    where: { name: DeptName.MARKETING },
  });
  assert(marketingDept.colorHex === "#6A1B9A", "Marketing dept color is purple #6A1B9A");
  console.log("  OK\n");

  console.log("Setup: ensure RELEASED batch with ISSUED COA + PDF attachment...");
  const { releasedBatch, issuedCoa } = await ensureMarketingReleasedCoaWithPdf();
  console.log(`  Fixture: batch=${releasedBatch.batchNo} coa=${issuedCoa.docNo}\n`);

  const diyaToken = await login("diya.sharma");
  const kavyaToken = await login("kavya.patel");

  // Check 2: list documents
  console.log("Check 2: GET /marketing/documents (released only, paginated)...");
  const list = await api<{
    data: { docNo: string; batchNo: string }[];
    meta: { total: number; page: number; limit: number };
  }>("GET", "/marketing/documents?limit=10", diyaToken);
  assert(list.ok, "list marketing documents");
  assert(list.data!.data.length >= 1, "at least one document");
  assert(list.data!.meta.total >= 1, "meta.total set");
  assert(
    list.data!.data.some((d) => d.batchNo === releasedBatch.batchNo),
    "fixture batch appears in list",
  );
  console.log("  OK\n");

  // Check 3: access scoping — 404 for unreleased content
  console.log("Check 3: Marketing cannot access unreleased batch/docs (404)...");
  const tempBatchNo = `MKT-TEST-${randomUUID().slice(0, 8)}`;
  const tempBatch = await prisma.batch.create({
    data: {
      productId: releasedBatch.productId,
      sourceSpecId: releasedBatch.sourceSpecId,
      batchNo: tempBatchNo,
      arnNo: `AR-TEST-${randomUUID().slice(0, 8)}`,
      status: BatchStatus.DRAFT,
      createdById: diya.id,
    },
  });
  const tempCoa = await prisma.batchDocument.create({
    data: {
      batchId: tempBatch.id,
      docType: DocType.COA,
      docNo: `COA/TEST/${tempBatchNo}`,
      status: DocStatus.PENDING,
    },
  });

  const coaBlocked = await api("GET", `/marketing/coas/${tempCoa.id}`, diyaToken);
  assert(!coaBlocked.ok && coaBlocked.status === 404, "non-issued COA returns 404");

  const batchBlocked = await api("GET", `/marketing/batches/${tempBatch.id}`, diyaToken);
  assert(!batchBlocked.ok && batchBlocked.status === 404, "non-released batch returns 404");

  const autoGenCoa = await prisma.batchDocument.findFirst({
    where: { batchId: releasedBatch.id, docType: DocType.COA, status: DocStatus.AUTO_GENERATED },
  });
  if (autoGenCoa) {
    const autoBlocked = await api("GET", `/marketing/coas/${autoGenCoa.id}`, diyaToken);
    assert(!autoBlocked.ok && autoBlocked.status === 404, "AUTO_GENERATED COA returns 404");
  }

  await prisma.batchDocument.delete({ where: { id: tempCoa.id } });
  await prisma.batch.delete({ where: { id: tempBatch.id } });
  console.log("  OK\n");

  // Check 4: role enforcement
  console.log("Check 4: QC_EXEC denied on /marketing/* (403)...");
  const forbidden = await api("GET", "/marketing/documents", kavyaToken);
  assert(!forbidden.ok && forbidden.status === 403, "QC_EXEC gets 403");
  console.log("  OK\n");

  // Check 5: issued COA detail
  console.log("Check 5: GET /marketing/coas/:id (results, verdict, lineage)...");
  const coaDetail = await api<{
    data: {
      coaResults: unknown[];
      complianceVerdict: string;
      signatureLineage: { createdById: string | null };
    };
  }>("GET", `/marketing/coas/${issuedCoa.id}`, diyaToken);
  assert(coaDetail.ok, "COA detail succeeds");
  assert(coaDetail.data!.data.coaResults.length > 0, "coaResults present");
  assert(coaDetail.data!.data.complianceVerdict != null, "complianceVerdict present");
  assert(coaDetail.data!.data.signatureLineage.createdById != null, "lineage present");

  const badCoa = await api("GET", `/marketing/coas/${randomUUID()}`, diyaToken);
  assert(!badCoa.ok && badCoa.status === 404, "unknown COA id returns 404");
  console.log("  OK — list/detail views are NOT audit-logged (system convention: reads only)\n");

  // Check 6: CC-ack seam (intentional 501 until Epic 27)
  console.log("Check 6: PATCH /marketing/cc-notifications/:id/ack → 501...");
  const ccAck = await api("PATCH", `/marketing/cc-notifications/${randomUUID()}/ack`, diyaToken, {});
  assert(!ccAck.ok && ccAck.status === 501, "CC ack returns 501");
  assert(ccAck.body?.includes("FEATURE_NOT_IMPLEMENTED") ?? false, "FEATURE_NOT_IMPLEMENTED code");
  console.log("  OK\n");

  // Check 7: PDF download — 200 with PDF bytes; 404 when no attachment
  console.log("Check 7: GET /marketing/coas/:id/download (PDF present → 200; absent → 404)...");
  const pdfDownload = await downloadRaw(`/marketing/coas/${issuedCoa.id}/download`, diyaToken);
  assert(pdfDownload.ok && pdfDownload.status === 200, "PDF download returns 200");
  assert(
    pdfDownload.contentType?.includes("application/pdf") ?? false,
    "Content-Type is application/pdf",
  );
  assert(pdfDownload.bytes.length > 1000, "PDF byteLength > 1000");
  assert(
    pdfDownload.bytes[0] === 0x25 &&
      pdfDownload.bytes[1] === 0x50 &&
      pdfDownload.bytes[2] === 0x44 &&
      pdfDownload.bytes[3] === 0x46,
    "body starts with %PDF magic",
  );
  console.log(`  PDF download OK — byteLength=${pdfDownload.bytes.length}`);

  const noPdfCoa = await prisma.batchDocument.create({
    data: {
      batchId: releasedBatch.id,
      docType: DocType.COA,
      docNo: `COA/NOPDF/${randomUUID().slice(0, 8)}`,
      status: DocStatus.ISSUED,
    },
  });
  const noPdfDownload = await downloadRaw(`/marketing/coas/${noPdfCoa.id}/download`, diyaToken);
  assert(!noPdfDownload.ok && noPdfDownload.status === 404, "COA without PDF returns 404");
  await prisma.batchDocument.delete({ where: { id: noPdfCoa.id } });
  console.log("  404 path OK — COA without PDF attachment");
  console.log("  OK\n");

  // Check 8: batch detail
  console.log("Check 8: GET /marketing/batches/:id...");
  const batchDetail = await api<{
    data: { issuedCoa: { id: string } | null; documents: unknown[] };
  }>("GET", `/marketing/batches/${releasedBatch.id}`, diyaToken);
  assert(batchDetail.ok, "batch detail succeeds");
  assert(batchDetail.data!.data.issuedCoa?.id === issuedCoa.id, "issued COA linked");
  assert(batchDetail.data!.data.documents.length >= 2, "released batch documents listed");
  console.log("  OK\n");

  // Check 9: audit row after marketing download
  console.log("Check 9: Marketing COA download creates EXPORT audit row...");
  const audit = await prisma.auditLog.findFirst({
    where: {
      action: AuditAction.EXPORT,
      entityType: AuditEntityType.COA,
      entityId: issuedCoa.id,
      userId: diya.id,
    },
    orderBy: { timestamp: "desc" },
  });
  assert(!!audit, "EXPORT audit row exists after marketing download");
  assert(audit!.docNo === issuedCoa.docNo, "audit docNo matches COA");
  assert(audit!.role === "MKT_EXEC", "audit role is MKT_EXEC");
  assert(
    audit!.comment?.includes("Marketing COA download") ?? false,
    "audit comment identifies marketing download",
  );
  console.log(
    `  OK — action=${audit!.action} entityType=${audit!.entityType} entityId=${audit!.entityId} userId=${audit!.userId} docNo=${audit!.docNo} ipAddress=${audit!.ipAddress ?? "null"}`,
  );
  console.log("  Convention: only download (EXPORT) audited — not list/detail reads\n");

  // Check 10: RUNTIME E2E — full marketing COA retrieval
  console.log("Check 10: RUNTIME E2E — MKT_EXEC login → list → detail → download → audited...");
  console.log("=== E2E MARKETING COA RETRIEVAL ===");
  console.log("login: diya.sharma (MKT_EXEC)");

  const e2eList = await api<{
    data: { id: string; docNo: string; batchNo: string }[];
    meta: { total: number };
  }>("GET", "/marketing/documents?type=COA&limit=10", diyaToken);
  assert(e2eList.ok, "E2E list");
  assert(e2eList.data!.data.length >= 1, "E2E list has COAs");
  const firstCoa = e2eList.data!.data.find((d) => d.id === issuedCoa.id) ?? e2eList.data!.data[0];
  console.log(`list: ${e2eList.data!.meta.total} items, target COA id=${firstCoa.id}`);

  const e2eDetail = await api<{
    data: { docNo: string; batchNo: string };
  }>("GET", `/marketing/coas/${firstCoa.id}`, diyaToken);
  assert(e2eDetail.ok, "E2E detail");
  console.log(`detail: docNo=${e2eDetail.data!.data.docNo}, batchNo=${e2eDetail.data!.data.batchNo}`);

  const e2eDownload = await downloadRaw(`/marketing/coas/${firstCoa.id}/download`, diyaToken);
  assert(e2eDownload.ok && e2eDownload.status === 200, "E2E download 200");
  const magic = e2eDownload.bytes.subarray(0, 4).toString("ascii");
  console.log(
    `download: status=${e2eDownload.status} byteLength=${e2eDownload.bytes.length} magic=${magic}`,
  );

  const e2eAudit = await prisma.auditLog.findFirst({
    where: {
      action: AuditAction.EXPORT,
      entityType: AuditEntityType.COA,
      entityId: firstCoa.id,
      userId: diya.id,
    },
    orderBy: { timestamp: "desc" },
  });
  assert(!!e2eAudit, "E2E audit row exists");
  console.log(
    `audit: action=${e2eAudit!.action} entityId=${e2eAudit!.entityId} userId=${e2eAudit!.userId} docNo=${e2eAudit!.docNo} ipAddress=${e2eAudit!.ipAddress ?? "null"}`,
  );
  console.log("=== END E2E MARKETING COA RETRIEVAL ===\n");
  console.log("  OK\n");

  console.log("All Epic 15 checks passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
