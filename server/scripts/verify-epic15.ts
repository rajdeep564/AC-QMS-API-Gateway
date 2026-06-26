/**
 * Epic 15 integration verification — requires seed + dev server on :4000
 */
import {
  BatchStatus,
  DeptName,
  DocStatus,
  DocType,
  PrismaClient,
} from "@prisma/client";
import { randomUUID } from "crypto";
import { randomUUID } from "crypto";

const SEED_GLYCINE_BATCH_NO = "B-2026-001";

const BASE = "http://localhost:4000/api/v1";
const PASSWORD = "Acqms@2026";

const prisma = new PrismaClient();

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

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
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

  const diyaToken = await login("diya.sharma");
  const kavyaToken = await login("kavya.patel");

  const releasedBatch = await prisma.batch.findUniqueOrThrow({
    where: { batchNo: SEED_GLYCINE_BATCH_NO },
  });
  assert(releasedBatch.status === BatchStatus.RELEASED, "seed batch is RELEASED");

  const issuedCoa = await prisma.batchDocument.findFirstOrThrow({
    where: {
      batchId: releasedBatch.id,
      docType: DocType.COA,
      status: DocStatus.ISSUED,
    },
  });

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
    list.data!.data.every((d) => d.batchNo === SEED_GLYCINE_BATCH_NO),
    "only released-batch documents",
  );
  console.log("  OK\n");

  // Check 3: access scoping — 404 for unreleased content
  console.log("Check 3: Marketing cannot access unreleased batch/docs (404)...");
  const product = await prisma.product.findUniqueOrThrow({ where: { code: "GLC" } });
  const template = await prisma.specTemplate.findFirstOrThrow({
    where: { productId: product.id },
  });
  const tempBatchNo = `MKT-TEST-${randomUUID().slice(0, 8)}`;
  const tempBatch = await prisma.batch.create({
    data: {
      productId: product.id,
      productMasterId: template.sourceMasterId,
      specTemplateId: template.id,
      batchNo: tempBatchNo,
      arn: `AR-TEST-${randomUUID().slice(0, 8)}`,
      mfgDateMonth: 1,
      mfgDateYear: 2026,
      expiryDate: new Date("2030-01-01"),
      currentDocPhase: "SPEC",
      status: BatchStatus.ACTIVE,
      createdById: diya.id,
    },
  });
  const tempCoa = await prisma.batchDocument.create({
    data: {
      batchId: tempBatch.id,
      docType: DocType.COA,
      docNo: `COA/TEST/${tempBatchNo}`,
      status: DocStatus.PENDING,
      optionalTestsActivated: [],
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
  console.log("  OK\n");

  // Check 6: CC-ack seam
  console.log("Check 6: PATCH /marketing/cc-notifications/:id/ack → 501...");
  const ccAck = await api("PATCH", `/marketing/cc-notifications/${randomUUID()}/ack`, diyaToken, {});
  assert(!ccAck.ok && ccAck.status === 501, "CC ack returns 501");
  assert(ccAck.body?.includes("FEATURE_NOT_IMPLEMENTED") ?? false, "FEATURE_NOT_IMPLEMENTED code");
  console.log("  OK\n");

  // Check 7: PDF download seam
  console.log("Check 7: GET /marketing/coas/:id/download → 501...");
  const pdf = await api("GET", `/marketing/coas/${issuedCoa.id}/download`, diyaToken);
  assert(!pdf.ok && pdf.status === 501, "PDF download returns 501");
  console.log("  OK\n");

  // Check 8: batch detail
  console.log("Check 8: GET /marketing/batches/:id...");
  const batchDetail = await api<{
    data: { issuedCoa: { id: string } | null; documents: unknown[] };
  }>("GET", `/marketing/batches/${releasedBatch.id}`, diyaToken);
  assert(batchDetail.ok, "batch detail succeeds");
  assert(batchDetail.data!.data.issuedCoa?.id === issuedCoa.id, "issued COA linked");
  assert(batchDetail.data!.data.documents.length >= 4, "released batch documents listed");
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
