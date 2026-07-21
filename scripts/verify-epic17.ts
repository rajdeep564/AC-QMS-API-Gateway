/**
 * Epic 17 B1 — GET /api/v1/audit read endpoint verification.
 * Requires seed + dev server on :4000.
 *
 * Deferred (not built in B1):
 * - Audit-log read access itself (US-17-4 DoD)
 * - Dept-scoped manager views (US-17-4)
 * - role / department filters (US-17-5)
 */
import "dotenv/config";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { AuditEntityType } from "../src/services/audit.service";
import { prisma } from "../src/lib/prisma-types";

const BASE = process.env.API_BASE_URL ?? "http://localhost:4000/api/v1";
const PASSWORD = process.env.VERIFY_SEED_PASSWORD ?? "Acqms@2026";

const PROJECTION_KEYS = [
  "id",
  "timestamp",
  "userId",
  "userName",
  "role",
  "department",
  "action",
  "entityType",
  "entityId",
  "docNo",
  "fieldChanged",
  "oldValue",
  "newValue",
  "comment",
  "ipAddress",
] as const;

type Check = { id: number; pass: boolean; evidence: string };
const results: Check[] = [];

function record(id: number, pass: boolean, evidence: string) {
  results.push({ id, pass, evidence });
}

function read(rel: string): string {
  return readFileSync(join(__dirname, "..", rel), "utf8");
}

async function login(username: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed for ${username}: ${res.status}`);
  const json = (await res.json()) as { data: { accessToken: string } };
  return json.data.accessToken;
}

async function apiGet(path: string, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, body: text };
}

function staticChecks() {
  const repo = read("src/modules/audit/audit.repository.ts");
  const service = read("src/modules/audit/audit.service.ts");
  const controller = read("src/modules/audit/audit.controller.ts");
  const routes = read("src/modules/audit/audit.routes.ts");
  const index = read("src/routes/index.ts");
  const writeRepo = read("src/services/audit.repository.ts");
  const writeService = read("src/services/audit.service.ts");

  record(
    1,
    repo.includes("auditLog.findMany") &&
      repo.includes("auditLog.count") &&
      !service.includes("prisma") &&
      !controller.includes("prisma") &&
      routes.includes("requireRole") &&
      index.includes('"/audit"'),
    "GET /audit three-layer module; Prisma only in audit.repository.ts; mounted",
  );

  record(
    2,
    service.includes("parsePagination") &&
      controller.includes("paginated(") &&
      repo.includes("skip") &&
      repo.includes("take"),
    "Paginated via parsePagination + paginated(); findMany uses skip/take",
  );

  record(
    12,
    repo.includes("auditLogListSelect") &&
      !repo.includes("include:") &&
      !repo.includes("user.find") &&
      PROJECTION_KEYS.every((k) => repo.includes(k)),
    "Projection via select only; no users join; denormalized fields",
  );

  record(
    13,
    !service.includes("auditLog(") &&
      !service.includes("log(") &&
      !controller.includes("auditLog"),
    "Read NOT audited (no audit write in read module); deferred per US-17-4",
  );

  record(
    14,
    repo.includes('orderBy: { timestamp: "desc" }') && repo.includes("take"),
    "Always paginated with timestamp DESC; never unbounded findMany",
  );

  const writeUntouched =
    writeRepo.includes("createAuditLog") &&
    writeService.includes("export async function log") &&
    !writeRepo.includes("findMany");
  record(15, writeUntouched, "Write-side audit.repository/service unchanged (INSERT only)");
}

async function runtimeChecks() {
  const sadminToken = await login("rajesh.kumar");
  const qcMgrToken = await login("priya.mehta");
  const qaMgrToken = await login("sanjay.reddy");
  const qcExecToken = await login("kavya.patel");
  const mktToken = await login("diya.sharma");

  const countBefore = await prisma.auditLog.count();

  // Check 3 — SADMIN 200, paginated, newest-first
  const sadminRes = await apiGet("/audit", sadminToken);
  const sadminData = sadminRes.json as {
    success: boolean;
    data: Array<{ id: string; timestamp: string }>;
    meta: { total: number; page: number; limit: number };
  } | null;

  const sadminOk =
    sadminRes.status === 200 &&
    sadminData?.success === true &&
    Array.isArray(sadminData.data) &&
    sadminData.data.length <= 20 &&
    sadminData.meta?.page === 1 &&
    sadminData.meta?.limit === 20 &&
    sadminData.meta.total > 0;

  let newestFirst = false;
  if (sadminData?.data && sadminData.data.length >= 2) {
    newestFirst =
      new Date(sadminData.data[0].timestamp).getTime() >=
      new Date(sadminData.data[1].timestamp).getTime();
  } else if (sadminData?.data?.length === 1) {
    newestFirst = true;
  }

  const firstRow = sadminData?.data?.[0];
  const rawSadmin = firstRow
    ? `total=${sadminData!.meta.total} page=${sadminData!.meta.page} limit=${sadminData!.meta.limit} firstRow={id:${firstRow.id},timestamp:${firstRow.timestamp}}`
    : "no rows";

  console.log("\n--- Check #3 RAW (SADMIN) ---");
  console.log(rawSadmin);
  console.log("--- end ---\n");

  record(
    3,
    sadminOk && newestFirst,
    `SADMIN 200; ${rawSadmin}; newest-first=${newestFirst}`,
  );

  // Check 4 — QC_MGR
  const qcMgrRes = await apiGet("/audit", qcMgrToken);
  record(4, qcMgrRes.status === 200, `QC_MGR status=${qcMgrRes.status}`);

  // Check 5 — QA_MGR
  const qaMgrRes = await apiGet("/audit", qaMgrToken);
  record(5, qaMgrRes.status === 200, `QA_MGR status=${qaMgrRes.status}`);

  // Check 6 — QC_EXEC 403
  const qcExecRes = await apiGet("/audit", qcExecToken);
  console.log("\n--- Check #6 RAW (QC_EXEC 403) ---");
  console.log(qcExecRes.body);
  console.log("--- end ---\n");
  record(6, qcExecRes.status === 403, `QC_EXEC status=${qcExecRes.status}`);

  // Check 7 — MKT_EXEC 403
  const mktRes = await apiGet("/audit", mktToken);
  record(7, mktRes.status === 403, `MKT_EXEC status=${mktRes.status}`);

  // Check 8 — unauthenticated 401
  const anonRes = await apiGet("/audit");
  record(8, anonRes.status === 401, `Unauthenticated status=${anonRes.status}`);

  // Check 9 — entityType=COA narrows
  const baseline = sadminData!.meta.total;
  const coaRes = await apiGet("/audit?entityType=COA", sadminToken);
  const coaData = coaRes.json as { meta: { total: number } };
  record(
    9,
    coaRes.status === 200 && coaData.meta.total < baseline && coaData.meta.total > 0,
    `entityType=COA total=${coaData.meta.total} < baseline=${baseline}`,
  );

  // Check 10 — individual filters
  const kavya = await prisma.user.findUniqueOrThrow({ where: { username: "kavya.patel" } });
  const sampleWithDocNo = await prisma.auditLog.findFirst({
    where: { docNo: { not: null } },
    select: { docNo: true },
  });
  const sampleLogin = await prisma.auditLog.findFirst({
    where: { action: "LOGIN" },
    select: { id: true },
  });
  const oldest = await prisma.auditLog.findFirst({
    orderBy: { timestamp: "asc" },
    select: { timestamp: true },
  });
  const newest = await prisma.auditLog.findFirst({
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });

  const actionRes = await apiGet("/audit?action=LOGIN&limit=5", sadminToken);
  const actionData = actionRes.json as { data: Array<{ action: string }> };
  const actionOk =
    actionRes.status === 200 &&
    actionData.data.length > 0 &&
    actionData.data.every((r) => r.action === "LOGIN");

  const userRes = await apiGet(`/audit?userId=${kavya.id}&limit=5`, sadminToken);
  const userData = userRes.json as { data: Array<{ userId: string | null }>; meta: { total: number } };
  const userOk =
    userRes.status === 200 &&
    userData.meta.total > 0 &&
    userData.data.every((r) => r.userId === kavya.id);

  let docNoOk = false;
  if (sampleWithDocNo?.docNo) {
    const docNoRes = await apiGet(
      `/audit?docNo=${encodeURIComponent(sampleWithDocNo.docNo)}`,
      sadminToken,
    );
    const docNoData = docNoRes.json as { meta: { total: number }; data: Array<{ docNo: string | null }> };
    docNoOk =
      docNoRes.status === 200 &&
      docNoData.meta.total > 0 &&
      docNoData.data.every((r) => r.docNo === sampleWithDocNo.docNo);
  }

  const from = oldest!.timestamp.toISOString();
  const to = newest!.timestamp.toISOString();
  const rangeRes = await apiGet(
    `/audit?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=5`,
    sadminToken,
  );
  const rangeData = rangeRes.json as { meta: { total: number } };
  const rangeOk = rangeRes.status === 200 && rangeData.meta.total === baseline;

  record(
    10,
    actionOk && userOk && docNoOk && rangeOk && sampleLogin != null,
    `action=${actionOk} userId=${userOk} docNo=${docNoOk} dateRange=${rangeOk}`,
  );

  // Check 11 — AND combine + invalid → 422
  const combinedRes = await apiGet(
    `/audit?entityType=COA&action=EXPORT&limit=5`,
    sadminToken,
  );
  const combinedData = combinedRes.json as { meta: { total: number } };
  const combinedBaseline = await apiGet("/audit?entityType=COA&limit=1", sadminToken);
  const combinedBaselineTotal = (combinedBaseline.json as { meta: { total: number } }).meta.total;
  const andOk =
    combinedRes.status === 200 && combinedData.meta.total <= combinedBaselineTotal;

  const invalidRes = await apiGet("/audit?entityType=NOT_A_REAL_TYPE", sadminToken);
  record(
    11,
    andOk && invalidRes.status === 422,
    `AND combined total=${combinedData.meta.total}<=${combinedBaselineTotal}; invalid entityType status=${invalidRes.status}`,
  );

  // Check 12 runtime — projection keys on first row
  const row = (sadminRes.json as { data: Record<string, unknown>[] }).data[0];
  const rowKeys = Object.keys(row).sort();
  const projectionOk =
    PROJECTION_KEYS.every((k) => k in row) && !("createdAt" in row) && !("passwordHash" in row);
  const existing12 = results.find((r) => r.id === 12);
  if (existing12) {
    existing12.pass = existing12.pass && projectionOk;
    existing12.evidence += `; runtime keys=${rowKeys.join(",")}`;
  }

  // Check 13 runtime — count unchanged after read
  const countAfter = await prisma.auditLog.count();
  const existing13 = results.find((r) => r.id === 13);
  if (existing13) {
    existing13.pass = existing13.pass && countBefore === countAfter;
    existing13.evidence += `; count before=${countBefore} after=${countAfter}`;
  }

  // Check 14 runtime — max limit enforced
  const maxRes = await apiGet("/audit?limit=200", sadminToken);
  const maxData = maxRes.json as { data: unknown[]; meta: { limit: number } };
  const existing14 = results.find((r) => r.id === 14);
  if (existing14) {
    existing14.pass =
      existing14.pass &&
      maxRes.status === 200 &&
      maxData.meta.limit === 100 &&
      maxData.data.length <= 100;
    existing14.evidence += `; limit=200 returns meta.limit=${maxData.meta.limit} rows=${maxData.data.length}`;
  }

  // Sanity: entityType enum value used in filter
  if (!Object.values(AuditEntityType).includes(AuditEntityType.COA)) {
    throw new Error("AuditEntityType.COA missing");
  }
}

async function typecheckAndVerifyAll() {
  try {
    execSync("npm run typecheck", { cwd: join(__dirname, ".."), stdio: "pipe" });
    record(15, results.find((r) => r.id === 15)?.pass ?? false, "typecheck exit 0; write-side untouched");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record(15, false, `typecheck failed: ${msg.slice(0, 200)}`);
  }
}

function printTable() {
  console.log("\n| # | Check | Pass/Fail | Evidence |");
  console.log("|---|-------|-----------|----------|");
  for (const r of results.sort((a, b) => a.id - b.id)) {
    console.log(`| ${r.id} | | ${r.pass ? "Pass" : "FAIL"} | ${r.evidence.replace(/\|/g, "\\|")} |`);
  }
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

async function main() {
  console.log("Epic 17 B1 verification starting...\n");

  staticChecks();
  await runtimeChecks();
  await typecheckAndVerifyAll();
  printTable();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
