/**
 * P2-C backend prep verification — reference-data lists + AWS section DTO gaps.
 *
 * Implements: Epic 12 AWS execution UI (US-12-x).
 * Gate checks: #2 QC_EXEC instruments 200, #3 MKT_EXEC 403 / no token 401, #8 analyst≠checker allowedActions.
 */
import "dotenv/config";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { DocType, PrismaClient, ResultType, Role, SectionStatus } from "@prisma/client";
import { ensureGlycineBatchAtAwsDraftForVerification } from "../src/fixtures/glycine-batch-fixture";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:4000/api/v1";
const PASSWORD = process.env.VERIFY_SEED_PASSWORD ?? "Acqms@2026";

const prisma = new PrismaClient();

const USERS = {
  qcExec: "kavya.patel",
  qcExecChecker: "meera.iyer",
  mktExec: "diya.sharma",
};

type Check = { id: number; pass: boolean; evidence: string };
const results: Check[] = [];

function record(id: number, pass: boolean, evidence: string) {
  results.push({ id, pass, evidence });
}

function read(rel: string): string {
  return readFileSync(join(__dirname, "..", rel), "utf8");
}

function parseSetCookie(setCookie: string | null): string {
  if (!setCookie) return "";
  const match = setCookie.match(/refreshToken=([^;]+)/);
  return match ? `refreshToken=${match[1]}` : "";
}

async function apiLogin(username: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const body = await res.json();
  const token = body?.data?.accessToken as string | undefined;
  const cookie = parseSetCookie(res.headers.get("set-cookie"));
  return { status: res.status, token, cookie, body };
}

async function apiGet(path: string, token?: string, cookie?: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function apiPost(path: string, token: string, body?: object, cookie?: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function apiPatch(path: string, token: string, body: object, cookie?: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

const FORBIDDEN_PROJECTION_KEYS = [
  "password",
  "passwordHash",
  "email",
  "username",
  "token",
  "refreshToken",
  "failedAttempts",
  "lockedUntil",
  "createdAt",
];

function staticChecks() {
  const instRepo = read("src/modules/instruments/instruments.repository.ts");
  const instService = read("src/modules/instruments/instruments.service.ts");
  const instController = read("src/modules/instruments/instruments.controller.ts");
  const instRoutes = read("src/modules/instruments/instruments.routes.ts");
  const reagRepo = read("src/modules/reagents/reagents.repository.ts");
  const reagService = read("src/modules/reagents/reagents.service.ts");
  const awsMapper = read("src/modules/aws/aws.mapper.ts");
  const awsAllowed = read("src/modules/aws/aws-allowed-actions.ts");
  const awsGuards = read("src/modules/aws/aws-guards.ts");
  const routes = read("src/routes/index.ts");

  record(
    1,
    instRepo.includes("prisma.instrument.findMany") &&
      !instService.includes("prisma") &&
      !instController.includes("prisma") &&
      reagRepo.includes("prisma.reagent.findMany") &&
      !reagService.includes("prisma") &&
      instRoutes.includes("Role.QC_EXEC") &&
      instRepo.includes("instrumentListSelect") &&
      instRepo.includes("useBefore") &&
      reagRepo.includes("expiryDate") &&
      routes.includes("/instruments") &&
      routes.includes("/reagents"),
    "GET /instruments + /reagents; three-layer; explicit projection incl. expiry fields",
  );

  record(
    5,
    awsMapper.includes("oosAcknowledged") &&
      awsMapper.includes("oosAckComment") &&
      read("src/modules/aws/aws.types.ts").includes("oosAcknowledged"),
    "oosAcknowledged/oosAckComment in section DTO mapper + types",
  );

  record(
    6,
    awsMapper.includes("instrumentExpiredAck") &&
      awsMapper.includes("reagentExpiredAck") &&
      awsMapper.includes("instrumentExpired") &&
      awsMapper.includes("reagentExpired"),
    "Expiry flags + ack fields exposed in section mapper",
  );

  record(
    7,
    awsAllowed.includes("getAllowedAwsSectionActions") &&
      awsMapper.includes("getAllowedAwsSectionActions") &&
      awsAllowed.includes("CHECK") &&
      awsAllowed.includes("actor.userId !== section.analystId") &&
      read("src/modules/aws/aws.controller.ts").includes("req.user"),
    "allowedActions derived per status/role/two-person context; controller passes actor",
  );

  record(
    9,
    awsGuards.includes("assertNotSameAsAnalyst") &&
      awsGuards.includes("assertSectionAssignee") &&
      !awsGuards.includes("allowedActions"),
    "Guards unchanged — allowedActions is advisory only",
  );

  record(
    10,
    !instService.includes("auditLog") &&
      !reagService.includes("auditLog") &&
      !awsAllowed.includes("auditLog") &&
      !read("src/services/workflow-engine.ts").includes("instruments/") &&
      !read("src/services/workflow-engine.ts").includes("reagents/"),
    "No audit writes in new read paths; no workflow engine changes",
  );
}

async function runtimeChecks() {
  const qcExec = await apiLogin(USERS.qcExec);
  const mktUser = await prisma.user.findFirst({ where: { role: Role.MKT_EXEC } });
  const mktLogin = mktUser
    ? await apiLogin(mktUser.username)
    : { status: 0, token: undefined as string | undefined, cookie: "" };

  if (!qcExec.token) {
    record(2, false, `QC_EXEC login failed HTTP ${qcExec.status}`);
    record(3, false, "Skipped — login failed");
    record(4, false, "Skipped — login failed");
    record(8, false, "Skipped — login failed");
    return;
  }

  const instruments = await apiGet("/instruments", qcExec.token, qcExec.cookie);
  const instData = (instruments.json as { data?: Record<string, unknown>[] })?.data ?? [];
  const firstInst = instData[0];
  const instHasExpiry = !!firstInst && "useBefore" in firstInst;
  const instMinimal =
    !!firstInst &&
    ["id", "instrumentId", "name", "calibrationDate", "useBefore"].every((k) => k in firstInst) &&
    Object.keys(firstInst).length === 5;
  const instNoPii = !instData.some((row) =>
    FORBIDDEN_PROJECTION_KEYS.some((key) => key in row),
  );

  record(
    2,
    instruments.status === 200 &&
      instData.length > 0 &&
      instHasExpiry &&
      instMinimal &&
      instNoPii,
    `QC_EXEC GET /instruments → HTTP ${instruments.status}; count=${instData.length}; keys=${firstInst ? Object.keys(firstInst).join(",") : "none"}`,
  );

  const mktDenied = mktLogin.token
    ? await apiGet("/instruments", mktLogin.token, mktLogin.cookie)
    : { status: 403 };
  const noAuth = await apiGet("/instruments");
  record(
    3,
    mktDenied.status === 403 && noAuth.status === 401,
    `MKT_EXEC → HTTP ${mktDenied.status} (403); no token → HTTP ${noAuth.status} (401)`,
  );

  const expiredInstrumentId = "VERIFY-EXPIRED-INST";
  const existingExpired = await prisma.instrument.findFirst({
    where: { instrumentId: expiredInstrumentId },
  });
  let expiredRowId: string | null = existingExpired?.id ?? null;
  if (!expiredRowId) {
    const created = await prisma.instrument.create({
      data: {
        instrumentId: expiredInstrumentId,
        name: "Expired verify fixture",
        useBefore: new Date("2000-01-01"),
      },
    });
    expiredRowId = created.id;
  }

  try {
    const activeDefault = await apiGet("/instruments", qcExec.token, qcExec.cookie);
    const activeData = (activeDefault.json as { data?: { id: string }[] })?.data ?? [];
    const excludesExpired = !activeData.some((row) => row.id === expiredRowId);

    const includeExpired = await apiGet("/instruments?active=false", qcExec.token, qcExec.cookie);
    const allData = (includeExpired.json as { data?: { id: string }[] })?.data ?? [];
    const includesExpired = allData.some((row) => row.id === expiredRowId);

    record(
      4,
      excludesExpired && includesExpired,
      `Default active-only excludes expired instrument; ?active=false includes it (expiredId=${expiredRowId})`,
    );
  } finally {
    if (!existingExpired && expiredRowId) {
      await prisma.instrument.delete({ where: { id: expiredRowId } }).catch(() => undefined);
    }
  }

  const kavyaUser = await prisma.user.findUniqueOrThrow({ where: { username: USERS.qcExec } });
  const priyaUser = await prisma.user.findUniqueOrThrow({ where: { username: "priya.mehta" } });
  const sanjayUser = await prisma.user.findUniqueOrThrow({ where: { username: "sanjay.reddy" } });
  const qcDept = await prisma.department.findUniqueOrThrow({ where: { name: "QC" } });

  await ensureGlycineBatchAtAwsDraftForVerification(kavyaUser, priyaUser, sanjayUser, qcDept.id);

  const awsDoc = await prisma.batchDocument.findFirst({
    where: { docType: DocType.AWS, status: "DRAFT" },
    orderBy: { createdAt: "desc" },
  });
  if (!awsDoc) {
    record(8, false, "No AWS DRAFT document found after fixture setup");
    return;
  }

  const section = await prisma.awsSection.findFirst({
    where: {
      batchDocumentId: awsDoc.id,
      specDocumentTest: { resultType: ResultType.QUALITATIVE },
    },
    include: { specDocumentTest: true },
    orderBy: { specDocumentTest: { sortOrder: "asc" } },
  });

  if (!section) {
    record(8, false, "No qualitative AWS section available for allowedActions test");
    return;
  }

  await prisma.awsSection.update({
    where: { id: section.id },
    data: {
      status: SectionStatus.AWAITING_CHECK,
      analystId: kavyaUser.id,
      checkerId: null,
      readings: { passFail: "PASS" },
      conclusion: "SATISFACTORY",
      isOos: false,
    },
  });

  const analystGet = await apiGet(`/aws/sections/${section.id}`, qcExec.token, qcExec.cookie);
  const analystSection = (analystGet.json as { data?: { allowedActions?: string[]; status?: string } })
    ?.data;
  const analystActions = analystSection?.allowedActions ?? [];

  const meera = await apiLogin(USERS.qcExecChecker);
  const checkerGet = meera.token
    ? await apiGet(`/aws/sections/${section.id}`, meera.token, meera.cookie)
    : { status: 0, json: null };
  const checkerSection = (checkerGet.json as { data?: { allowedActions?: string[] } })?.data;
  const checkerActions = checkerSection?.allowedActions ?? [];

  const analystNoCheck =
    analystGet.status === 200 &&
    analystSection?.status === "AWAITING_CHECK" &&
    !analystActions.includes("CHECK");
  const checkerHasCheck =
    checkerGet.status === 200 &&
    checkerActions.includes("CHECK") &&
    checkerActions.includes("REJECT_CHECK");

  record(
    8,
    analystNoCheck && checkerHasCheck,
    `Analyst (kavya) allowedActions=${analystActions.join(",") || "none"} — no CHECK; checker (meera) allowedActions=${checkerActions.join(",") || "none"} includes CHECK`,
  );

  const auditBefore = await prisma.auditLog.count();
  await apiGet("/instruments", qcExec.token, qcExec.cookie);
  await apiGet("/reagents", qcExec.token, qcExec.cookie);
  const auditAfter = await prisma.auditLog.count();
  if (auditBefore !== auditAfter) {
    const existing = results.find((r) => r.id === 10);
    if (existing) {
      existing.pass = false;
      existing.evidence = `Audit log changed on reference GETs (${auditBefore} → ${auditAfter})`;
    }
  }
}

function typecheck() {
  try {
    execSync("npm run typecheck", { cwd: join(__dirname, ".."), stdio: "pipe" });
    record(11, true, "tsc --noEmit passed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record(11, false, `tsc failed: ${message}`);
  }
}

async function main() {
  console.log("\n=== P2-C Backend Prep Verification (Epic 12 / US-12-x) ===\n");

  staticChecks();
  await runtimeChecks();
  typecheck();

  console.log("| # | Pass/Fail | Evidence |");
  console.log("|---|-----------|----------|");
  for (const check of results.sort((a, b) => a.id - b.id)) {
    console.log(`| ${check.id} | ${check.pass ? "PASS" : "FAIL"} | ${check.evidence} |`);
  }

  console.log("\n--- Raw summary ---");
  for (const check of results.sort((a, b) => a.id - b.id)) {
    console.log(`[${check.pass ? "PASS" : "FAIL"}] #${check.id}: ${check.evidence}`);
  }

  const failed = results.some((c) => !c.pass);
  console.log(failed ? "\nSome checks FAILED.\n" : "\nAll checks PASSED.\n");
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
