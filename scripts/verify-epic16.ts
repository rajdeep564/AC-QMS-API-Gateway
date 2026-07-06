/**
 * Epic 16 integration verification — requires seed + dev server on :4000
 */
import { DeptName, DocType, PrismaClient, SectionStatus } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";
import { ensureGlycineBatchAtAwsDraftForVerification } from "../src/fixtures/glycine-batch-fixture";
  
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

async function userId(username: string): Promise<string> {
  const u = await prisma.user.findUniqueOrThrow({ where: { username } });
  return u.id;
}

async function clearUserNotifications(...usernames: string[]) {
  const ids = await Promise.all(usernames.map(userId));
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
}

async function completeAllAwsSections(kavya: string, meera: string, awsDocId: string) {
  const listRes = await api<{
    data: { sections: { id: string; testName: string }[] };
  }>("GET", `/aws/${awsDocId}/sections`, kavya);
  const sections = listRes.data!.data.sections;

  for (const section of sections) {
    if (section.testName === "Assay") {
      await api("PATCH", `/aws-sections/${section.id}`, kavya, {
        observations: {
          variables: {
            sample_titrant_volume: 24.5,
            std_titrant_volume: 24.5,
            std_concentration: 1.0042,
          },
        },
      });
    } else if (section.testName === "pH") {
      await api("PATCH", `/aws-sections/${section.id}`, kavya, {
        observations: { variables: { value: 6.2 } },
      });
    } else {
      await api("PATCH", `/aws-sections/${section.id}`, kavya, {
        observations: { passFail: "PASS" },
      });
    }
    await api("POST", `/aws-sections/${section.id}/complete`, kavya);
    await api("POST", `/aws-sections/${section.id}/check`, meera, { password: PASSWORD });
  }
}

async function main() {
  console.log("Epic 16 verification starting...\n");

  const kavyaUser = await prisma.user.findUniqueOrThrow({ where: { username: "kavya.patel" } });
  const priyaUser = await prisma.user.findUniqueOrThrow({ where: { username: "priya.mehta" } });
  const sanjayUser = await prisma.user.findUniqueOrThrow({ where: { username: "sanjay.reddy" } });
  const qcDept = await prisma.department.findUniqueOrThrow({ where: { name: DeptName.QC } });
  await ensureGlycineBatchAtAwsDraftForVerification(kavyaUser, priyaUser, sanjayUser, qcDept.id);

  const kavya = await login("kavya.patel");
  const meera = await login("meera.iyer");
  const priya = await login("priya.mehta");
  const sanjay = await login("sanjay.reddy");
  const diya = await login("diya.sharma");

  const kavyaId = await userId("kavya.patel");
  const priyaId = await userId("priya.mehta");
  const sanjayId = await userId("sanjay.reddy");
  const diyaId = await userId("diya.sharma");

  await clearUserNotifications(
    "kavya.patel",
    "priya.mehta",
    "sanjay.reddy",
    "meera.iyer",
    "diya.sharma",
    "anand.joshi",
  );

  const batch = await prisma.batch.findUniqueOrThrow({ where: { batchNo: "B-2026-001" } });
  const awsDoc = await prisma.batchDocument.findFirstOrThrow({
    where: { batchId: batch.id, docType: DocType.AWS },
  });

  // Check 2: submit targeting
  console.log("Check 2: AWS submit notifies QC_MGR only (excludes submitter)...");
  const blocked = await api("POST", `/documents/${awsDoc.id}/submit`, kavya, {
    password: PASSWORD,
  });
  assert(!blocked.ok && blocked.status === 409, "incomplete submit blocked");

  const priyaBefore = await prisma.notification.count({ where: { userId: priyaId } });
  assert(priyaBefore === 0, "no notifications before successful submit");

  await completeAllAwsSections(kavya, meera, awsDoc.id);

  const submit = await api("POST", `/documents/${awsDoc.id}/submit`, kavya, {
    password: PASSWORD,
  });
  assert(submit.ok, "AWS submit succeeds");

  const priyaNotif = await prisma.notification.findFirst({
    where: { userId: priyaId, type: "AWS_SUBMITTED" },
    orderBy: { createdAt: "desc" },
  });
  assert(priyaNotif != null, "Priya notified on submit");
  assert(!priyaNotif.isRead, "notification unread");
  assert(priyaNotif.link?.includes(batch.id), "link contains batch id");

  const kavyaNotif = await prisma.notification.count({
    where: { userId: kavyaId, type: "AWS_SUBMITTED" },
  });
  assert(kavyaNotif === 0, "submitter excluded");

  const sanjaySubmit = await prisma.notification.count({
    where: { userId: sanjayId, type: "AWS_SUBMITTED" },
  });
  assert(sanjaySubmit === 0, "QA not notified on submit");
  console.log("  OK\n");

  // Check 3: list + unread-count
  console.log("Check 3: GET /notifications + unread-count...");
  const list = await api<{
    data: { type: string; title: string; message: string }[];
  }>("GET", "/notifications?unreadOnly=true", priya);
  assert(list.ok, "list notifications");
  assert(list.data!.data.length >= 1, "at least one unread");
  assert(list.data!.data[0].type === "AWS_SUBMITTED", "correct type");

  const count = await api<{ data: { count: number } }>(
    "GET",
    "/notifications/unread-count",
    priya,
  );
  assert(count.ok && count.data!.data.count >= 1, "unread-count >= 1");
  console.log("  OK\n");

  // Check 6: reject with comment (before approve)
  console.log("Check 6: reject notifies creator with comment...");
  await clearUserNotifications("kavya.patel", "priya.mehta");

  const reject = await api("POST", `/documents/${awsDoc.id}/reject`, priya, {
    password: PASSWORD,
    comment: "Please verify section calculations",
  });
  assert(reject.ok, "reject succeeds");

  const rejectNotif = await prisma.notification.findFirst({
    where: { userId: kavyaId, type: "AWS_REJECTED" },
    orderBy: { createdAt: "desc" },
  });
  assert(rejectNotif != null, "creator notified on reject");
  assert(
    rejectNotif.message.includes("Please verify section calculations"),
    "reject comment in message",
  );
  console.log("  OK\n");

  // Re-submit for approve/sign flow
  await clearUserNotifications("kavya.patel", "priya.mehta", "sanjay.reddy");
  await api("POST", `/documents/${awsDoc.id}/submit`, kavya, { password: PASSWORD });

  // Check 4: approve -> QA_MGR
  console.log("Check 4: approve notifies QA_MGR, excludes approver...");
  const approve = await api("POST", `/documents/${awsDoc.id}/approve`, priya, {
    password: PASSWORD,
  });
  assert(approve.ok, "approve succeeds");

  const sanjayApprove = await prisma.notification.findFirst({
    where: { userId: sanjayId, type: "AWS_QC_APPROVED" },
    orderBy: { createdAt: "desc" },
  });
  assert(sanjayApprove != null, "Sanjay notified on approve");
  const priyaSelf = await prisma.notification.count({
    where: { userId: priyaId, type: "AWS_QC_APPROVED" },
  });
  assert(priyaSelf === 0, "approver excluded");
  console.log("  OK\n");

  // Check 5: sign -> assigned exec
  console.log("Check 5: QA sign notifies assigned QC exec...");
  await clearUserNotifications("kavya.patel", "sanjay.reddy");
  const sign = await api("POST", `/documents/${awsDoc.id}/sign`, sanjay, {
    password: PASSWORD,
  });
  assert(sign.ok, "sign succeeds");

  const kavyaSigned = await prisma.notification.findFirst({
    where: { userId: kavyaId, type: "AWS_QA_SIGNED" },
    orderBy: { createdAt: "desc" },
  });
  assert(kavyaSigned != null, "Kavya notified on QA sign");
  console.log("  OK\n");

  // Check 7: BATCH_RELEASED
  console.log("Check 7: sign-and-issue notifies stakeholders...");
  await clearUserNotifications("kavya.patel", "priya.mehta", "sanjay.reddy", "diya.sharma");

  const coaDoc = await prisma.batchDocument.findFirstOrThrow({
    where: { batchId: batch.id, docType: DocType.COA },
  });
  const release = await api("POST", `/documents/${coaDoc.id}/sign-and-issue`, sanjay, {
    password: PASSWORD,
  });
  assert(release.ok, "sign-and-issue");

  const releasedNotifs = await prisma.notification.findMany({
    where: { type: "BATCH_RELEASED" },
  });
  const releasedUserIds = new Set(releasedNotifs.map((n) => n.userId));
  assert(releasedUserIds.has(kavyaId), "QC exec notified on release");
  assert(releasedUserIds.has(priyaId), "QC_MGR notified on release");
  assert(releasedUserIds.has(sanjayId) === false, "releaser excluded");
  assert(releasedUserIds.has(diyaId), "MKT_EXEC notified on release");
  console.log("  OK\n");

  // Check 8: cross-user safety
  console.log("Check 8: cross-user read/mark blocked...");
  const priyaFirst = await prisma.notification.findFirst({
    where: { userId: priyaId },
    orderBy: { createdAt: "desc" },
  });
  assert(priyaFirst != null, "priya has a notification");

  const crossRead = await api("PATCH", `/notifications/${priyaFirst.id}/read`, kavya);
  assert(!crossRead.ok && (crossRead.status === 404 || crossRead.status === 403), "cross-user mark-read blocked");

  const kavyaList = await api<{ data: { id: string }[] }>(
    "GET",
    "/notifications",
    kavya,
  );
  assert(
    !kavyaList.data!.data.some((n) => n.id === priyaFirst.id),
    "GET list scoped to caller only",
  );
  console.log("  OK\n");

  // Check 9: mark-all-read
  console.log("Check 9: mark-all-read...");
  await prisma.notification.updateMany({
    where: { userId: priyaId },
    data: { isRead: false },
  });
  const markAll = await api<{ data: { count: number } }>(
    "POST",
    "/notifications/mark-all-read",
    priya,
  );
  assert(markAll.ok && markAll.data!.data.count >= 1, "mark-all-read count");
  const unreadAfter = await prisma.notification.count({
    where: { userId: priyaId, isRead: false },
  });
  assert(unreadAfter === 0, "all read after mark-all");
  console.log("  OK\n");

  // Check 10: tx rollback — no orphan notifications
  console.log("Check 10: tx rollback rolls back notifications...");
  const beforeCount = await prisma.notification.count();
  try {
    await prisma.$transaction(async (tx) => {
      const { notify } = await import("../src/services/notification.service");
      await notify({
        recipients: { users: [priyaId] },
        type: "TX_TEST",
        title: "rollback test",
        message: "should not persist",
        tx,
      });
      throw new Error("forced rollback");
    });
  } catch {
    // expected
  }
  const afterCount = await prisma.notification.count();
  assert(afterCount === beforeCount, "no orphan notifications after rollback");
  console.log("  OK\n");

  // Check 11: resilience — notify catch path exists
  console.log("Check 11: notify log-and-continue path exists...");
  const notifySrc = readFileSync(
    join(__dirname, "../src/services/notification.service.ts"),
    "utf8",
  );
  assert(notifySrc.includes("try {") && notifySrc.includes("catch"), "notify wrapped in try/catch");
  assert(notifySrc.includes("Failed to dispatch notification"), "failure logged not thrown");
  console.log("  OK\n");

  console.log("All Epic 16 checks passed.");
  console.log("Run verify-epic12c after re-seed for document-chain regression.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
