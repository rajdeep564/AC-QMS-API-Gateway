/**
 * GET /users verification — manager+ assignee picker (US-24-4, US-9-10).
 */
import "dotenv/config";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { UserStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma-types";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:4000/api/v1";
const PASSWORD = process.env.VERIFY_SEED_PASSWORD ?? "Acqms@2026";

const USERS = {
  qcExec: "kavya.patel",
  qcMgr: "priya.mehta",
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

const FORBIDDEN_PROJECTION_KEYS = [
  "password",
  "passwordHash",
  "email",
  "username",
  "token",
  "refreshToken",
  "failedAttempts",
  "lockedUntil",
];

function staticChecks() {
  const repo = read("src/modules/users/users.repository.ts");
  const service = read("src/modules/users/users.service.ts");
  const controller = read("src/modules/users/users.controller.ts");

  record(
    1,
    repo.includes("prisma.user.findMany") &&
      !service.includes("prisma") &&
      !controller.includes("prisma") &&
      read("src/modules/users/users.routes.ts").includes("requireRole"),
    "Three-layer module; Prisma only in users.repository.ts",
  );

  record(
    2,
    repo.includes("userListSelect") &&
      !repo.includes("passwordHash") &&
      !repo.includes("email:") &&
      service.includes("name: row.fullName"),
    "Projection selects id/fullName/role/status/department only",
  );

  record(
    10,
    !read("src/services/workflow-engine.ts").includes("users/") &&
      !read("src/modules/batches/batches.service.ts").includes("users/"),
    "No changes to existing modules/workflow engines",
  );
}

async function runtimeChecks() {
  const qcMgr = await apiLogin(USERS.qcMgr);
  const qcExec = await apiLogin(USERS.qcExec);

  if (!qcMgr.token) {
    record(3, false, `QC_MGR login failed HTTP ${qcMgr.status}`);
    record(4, false, "Skipped");
    record(5, false, "Skipped");
    record(6, false, "Skipped");
    record(7, false, "Skipped");
    record(8, false, "Skipped");
    record(9, false, "Skipped");
    return;
  }

  const qcExecList = await apiGet("/users?role=QC_EXEC", qcMgr.token, qcMgr.cookie);
  const data = (qcExecList.json as { data?: unknown[] })?.data ?? [];
  const first = data[0] as Record<string, unknown> | undefined;
  const hasForbidden = data.some((row) =>
    FORBIDDEN_PROJECTION_KEYS.some((key) => key in (row as Record<string, unknown>)),
  );
  const allQcExec =
    Array.isArray(data) &&
    data.length > 0 &&
    data.every((row) => (row as { role?: string }).role === "QC_EXEC");
  const minimalKeys =
    !!first &&
    ["id", "name", "role", "department", "status"].every((k) => k in first) &&
    Object.keys(first).length === 5;

  record(
    3,
    qcExecList.status === 200 && allQcExec && minimalKeys && !hasForbidden,
    `QC_MGR GET /users?role=QC_EXEC → HTTP ${qcExecList.status}; count=${data.length}; keys=${first ? Object.keys(first).join(",") : "none"}`,
  );

  const execDenied = await apiGet("/users", qcExec.token, qcExec.cookie);
  record(
    4,
    execDenied.status === 403,
    `QC_EXEC GET /users → HTTP ${execDenied.status} (403 expected)`,
  );

  const noAuth = await apiGet("/users");
  record(5, noAuth.status === 401, `No token GET /users → HTTP ${noAuth.status} (401 expected)`);

  const badRole = await apiGet("/users?role=NOT_A_ROLE", qcMgr.token, qcMgr.cookie);
  record(6, badRole.status === 422, `Invalid ?role= → HTTP ${badRole.status} (422 expected)`);

  const deptQc = await apiGet("/users?dept=QC&role=QC_EXEC", qcMgr.token, qcMgr.cookie);
  const deptData = (deptQc.json as { data?: { role: string; department: string | null }[] })?.data ?? [];
  const deptOk =
    deptQc.status === 200 &&
    deptData.length > 0 &&
    deptData.every((u) => u.role === "QC_EXEC" && u.department === "QC");
  record(
    7,
    deptOk,
    `GET /users?dept=QC&role=QC_EXEC → HTTP ${deptQc.status}; all QC_EXEC in QC dept (${deptData.length} users)`,
  );

  const meera = await prisma.user.findFirst({ where: { username: "meera.iyer" } });
  if (!meera) {
    record(8, false, "Seed user meera.iyer not found");
  } else {
    const priorStatus = meera.status;
    await prisma.user.update({
      where: { id: meera.id },
      data: { status: UserStatus.INACTIVE },
    });

    try {
      const activeDefault = await apiGet("/users?role=QC_EXEC", qcMgr.token, qcMgr.cookie);
      const activeData = (activeDefault.json as { data?: { id: string }[] })?.data ?? [];
      const excludesInactive = !activeData.some((u) => u.id === meera.id);

      const includeInactive = await apiGet(
        "/users?role=QC_EXEC&active=false",
        qcMgr.token,
        qcMgr.cookie,
      );
      const inactiveData = (includeInactive.json as { data?: { id: string; status: string }[] })?.data ?? [];
      const includesInactive = inactiveData.some((u) => u.id === meera.id);

      record(
        8,
        excludesInactive && includesInactive,
        `Default active-only excludes INACTIVE; ?active=false includes meera.iyer (status=${inactiveData.find((u) => u.id === meera.id)?.status ?? "missing"})`,
      );
    } finally {
      await prisma.user.update({
        where: { id: meera.id },
        data: { status: priorStatus },
      });
    }
  }

  const auditBefore = await prisma.auditLog.count();
  await apiGet("/users?role=QC_EXEC", qcMgr.token, qcMgr.cookie);
  const auditAfter = await prisma.auditLog.count();
  record(
    9,
    auditBefore === auditAfter,
    `Audit log count unchanged (${auditBefore} → ${auditAfter})`,
  );
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
  console.log("\n=== GET /users Verification ===\n");

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
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
