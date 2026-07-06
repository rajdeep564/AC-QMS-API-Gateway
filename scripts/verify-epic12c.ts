/**
 * Epic 12c integration verification — requires seed + dev server on :4000
 */
import {
  BatchStatus,
  CoaComplianceVerdict,
  DeptName,
  DocPhase,
  DocStatus,
  DocType,
  PrismaClient,
  SectionStatus,
} from "@prisma/client";
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

async function completeAllAwsSections(
  kavya: string,
  meera: string,
  awsDocId: string,
  options: { assayInSpec?: boolean } = {},
): Promise<void> {
  const assayInSpec = options.assayInSpec !== false;

  const listRes = await api<{
    data: {
      sections: { id: string; testName: string }[];
    };
  }>("GET", `/aws/${awsDocId}/sections`, kavya);
  assert(listRes.ok, "list sections");

  const sections = listRes.data!.data.sections;
  const assay = sections.find((s) => s.testName === "Assay")!;

  for (const section of sections) {
    if (section.testName === "Assay") {
      if (assayInSpec) {
        await api("PATCH", `/aws-sections/${section.id}`, kavya, {
          observations: {
            variables: {
              sample_titrant_volume: 24.5,
              std_titrant_volume: 24.5,
              std_concentration: 1.0042,
            },
          },
        });
      } else {
        await api("PATCH", `/aws-sections/${section.id}`, kavya, {
          observations: {
            variables: {
              sample_titrant_volume: 20,
              std_titrant_volume: 24.5,
              std_concentration: 1.0,
            },
          },
        });
        await api("POST", `/aws-sections/${section.id}/acknowledge-oos`, kavya, {
          comment: "OOS acknowledged for non-compliant demo path",
        });
      }
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

  if (!assayInSpec) {
    const assayRow = await prisma.awsSection.findUniqueOrThrow({ where: { id: assay.id } });
    assert(assayRow.oosDetected === true, "assay OOS for non-compliant path");
  }
}

async function main() {
  console.log("Epic 12c verification starting...\n");

  const kavyaUser = await prisma.user.findUniqueOrThrow({ where: { username: "kavya.patel" } });
  const priyaUser = await prisma.user.findUniqueOrThrow({ where: { username: "priya.mehta" } });
  const sanjayUser = await prisma.user.findUniqueOrThrow({ where: { username: "sanjay.reddy" } });
  const qcDept = await prisma.department.findUniqueOrThrow({ where: { name: DeptName.QC } });
  await ensureGlycineBatchAtAwsDraftForVerification(kavyaUser, priyaUser, sanjayUser, qcDept.id);

  const kavya = await login("kavya.patel");
  const meera = await login("meera.iyer");
  const priya = await login("priya.mehta");
  const sanjay = await login("sanjay.reddy");

  const batch = await prisma.batch.findUniqueOrThrow({ where: { batchNo: "B-2026-001" } });
  const awsDoc = await prisma.batchDocument.findFirstOrThrow({
    where: { batchId: batch.id, docType: DocType.AWS },
  });
  let coaDoc = await prisma.batchDocument.findFirstOrThrow({
    where: { batchId: batch.id, docType: DocType.COA },
  });

  // Check 2: AWS submit gating
  console.log("Check 2: AWS submit blocked when sections incomplete...");
  const blockedSubmit = await api("POST", `/documents/${awsDoc.id}/submit`, kavya, {
    password: PASSWORD,
  });
  assert(!blockedSubmit.ok && blockedSubmit.status === 409, "submit blocked with 409");
  assert(
    blockedSubmit.body?.includes("AWS_SECTIONS_INCOMPLETE"),
    "AWS_SECTIONS_INCOMPLETE code",
  );
  console.log("  OK\n");

  // Complete sections in-spec for lifecycle checks
  console.log("Completing all AWS sections (in-spec)...");
  await completeAllAwsSections(kavya, meera, awsDoc.id, { assayInSpec: true });

  const readyList = await api<{ data: { allSectionsComplete: boolean } }>(
    "GET",
    `/aws/${awsDoc.id}/sections`,
    kavya,
  );
  assert(readyList.data!.data.allSectionsComplete === true, "allSectionsComplete true");

  // Check 3: AWS lifecycle guards
  console.log("Check 3: AWS lifecycle (roles, self-approval, password, reject)...");
  const wrongRole = await api("POST", `/documents/${awsDoc.id}/approve`, kavya, {
    password: PASSWORD,
  });
  assert(!wrongRole.ok && wrongRole.status === 403, "QC_EXEC cannot approve");

  const badPassword = await api("POST", `/documents/${awsDoc.id}/submit`, kavya, {
    password: "wrong-password",
  });
  assert(!badPassword.ok && badPassword.status === 401, "bad password rejected");

  const submitOk = await api("POST", `/documents/${awsDoc.id}/submit`, kavya, {
    password: PASSWORD,
  });
  assert(submitOk.ok, "AWS submit succeeds when complete");

  const selfApprove = await api("POST", `/documents/${awsDoc.id}/approve`, kavya, {
    password: PASSWORD,
  });
  assert(!selfApprove.ok && selfApprove.status === 403, "self-approval blocked on approve");

  await api("POST", `/documents/${awsDoc.id}/approve`, priya, { password: PASSWORD });

  const selfSign = await api("POST", `/documents/${awsDoc.id}/sign`, priya, {
    password: PASSWORD,
  });
  assert(!selfSign.ok && selfSign.status === 403, "QC approver cannot QA sign");

  const rejectBack = await api("POST", `/documents/${awsDoc.id}/reject`, sanjay, {
    password: PASSWORD,
    comment: "Reject for section retention test",
  });
  assert(rejectBack.ok, "QA reject to DRAFT");

  const awsAfterReject = await prisma.batchDocument.findUniqueOrThrow({
    where: { id: awsDoc.id },
  });
  assert(awsAfterReject.status === DocStatus.DRAFT, "AWS back to DRAFT");

  const completedSections = await prisma.awsSection.count({
    where: { batchDocumentId: awsDoc.id, status: SectionStatus.COMPLETED },
  });
  const totalSections = await prisma.awsSection.count({ where: { batchDocumentId: awsDoc.id } });
  assert(completedSections === totalSections, "sections remain COMPLETED after doc reject");
  console.log("  OK\n");

  // Re-submit lifecycle for COA generation
  await api("POST", `/documents/${awsDoc.id}/submit`, kavya, { password: PASSWORD });
  await api("POST", `/documents/${awsDoc.id}/approve`, priya, { password: PASSWORD });
  await api("POST", `/documents/${awsDoc.id}/sign`, sanjay, { password: PASSWORD });

  // Check 4: COA auto-generation
  console.log("Check 4: COA auto-generated on AWS QA sign...");
  coaDoc = await prisma.batchDocument.findUniqueOrThrow({ where: { id: coaDoc.id } });
  assert(coaDoc.status === DocStatus.AUTO_GENERATED, "COA AUTO_GENERATED");

  const coaResults = await prisma.coaResult.findMany({
    where: { batchDocumentId: coaDoc.id },
    orderBy: { sortOrder: "asc" },
  });
  assert(coaResults.length === totalSections, "coa_results row per section");
  assert(coaResults.every((r) => r.result && r.acceptanceLimits && r.conclusion), "formatted rows");
  assert(coaDoc.complianceVerdict === CoaComplianceVerdict.COMPLIES, "COMPLIES verdict");

  const batchAfterCoa = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
  assert(batchAfterCoa.currentDocPhase === DocPhase.COA, "batch phase COA");

  const generateAudit = await prisma.auditLog.findFirst({
    where: {
      entityType: "COA",
      entityId: coaDoc.id,
      action: "GENERATE",
    },
    orderBy: { createdAt: "desc" },
  });
  assert(generateAudit != null, "System GENERATE audit");
  assert(generateAudit.userName === "System", "System user on GENERATE audit");
  console.log("  OK\n");

  // Check 5: DOES NOT COMPLY path (isolated batch via direct generator call)
  console.log("Check 5: DOES NOT COMPLY verdict path...");

  const ncBatch = await prisma.batch.create({
    data: {
      productId: batch.productId,
      productMasterId: batch.productMasterId,
      specTemplateId: batch.specTemplateId,
      batchNo: `B-NC-${Date.now()}`,
      arn: `ARN-NC-${Date.now()}`,
      mfgDateMonth: batch.mfgDateMonth,
      mfgDateYear: batch.mfgDateYear,
      expiryDate: batch.expiryDate,
      currentDocPhase: DocPhase.AWS,
      status: BatchStatus.ACTIVE,
      assignedQcExecId: batch.assignedQcExecId,
      createdById: batch.createdById,
    },
  });

  const ncCoa = await prisma.batchDocument.create({
    data: {
      batchId: ncBatch.id,
      docType: DocType.COA,
      docNo: `COA/GLC/${ncBatch.batchNo}`,
      status: DocStatus.PENDING,
      optionalTestsActivated: [],
    },
  });

  const ncAws = await prisma.batchDocument.create({
    data: {
      batchId: ncBatch.id,
      docType: DocType.AWS,
      docNo: `AWS/GLC/${ncBatch.batchNo}`,
      status: DocStatus.QA_SIGNED,
      optionalTestsActivated: [],
      submittedById: kavyaUser.id,
      qcApprovedById: priyaUser.id,
      qaSignedById: sanjayUser.id,
    },
  });

  const templateSections = await prisma.awsSection.findMany({
    where: { batchDocumentId: awsDoc.id },
    include: { specDocumentTest: true },
  });

  for (const section of templateSections) {
    const isAssay = section.specDocumentTest?.testName === "Assay";
    await prisma.awsSection.create({
      data: {
        batchDocumentId: ncAws.id,
        testParameterId: section.testParameterId,
        specDocumentTestId: section.specDocumentTestId,
        sortOrder: section.sortOrder,
        status: SectionStatus.COMPLETED,
        observations: isAssay
          ? {
              variables: {
                sample_titrant_volume: 20,
                std_titrant_volume: 24.5,
                std_concentration: 1.0,
              },
            }
          : section.observations ?? { passFail: "PASS" },
        resultDisplay: isAssay ? "85.0 %" : section.resultDisplay,
        conclusion: isAssay ? "NOT_SATISFACTORY" : section.conclusion ?? "PASS",
        oosDetected: isAssay,
        oosAcknowledged: isAssay,
      },
    });
  }

  const { generateCoaFromSignedAws } = await import("../src/services/coa-generator");
  await prisma.$transaction(async (tx) => {
    await generateCoaFromSignedAws(tx, ncBatch.id, ncAws.id, ncAws.docNo);
  });

  const ncCoaAfter = await prisma.batchDocument.findUniqueOrThrow({ where: { id: ncCoa.id } });
  assert(
    ncCoaAfter.complianceVerdict === CoaComplianceVerdict.DOES_NOT_COMPLY,
    "DOES NOT COMPLY verdict",
  );

  await prisma.coaResult.deleteMany({ where: { batchDocumentId: ncCoa.id } });
  await prisma.awsSection.deleteMany({ where: { batchDocumentId: ncAws.id } });
  await prisma.batchDocument.deleteMany({ where: { batchId: ncBatch.id } });
  await prisma.batch.delete({ where: { id: ncBatch.id } });
  console.log("  OK\n");

  // Check 6: sign-and-issue
  console.log("Check 6: COA sign-and-issue releases batch...");
  const coaDetailBefore = await api<{
    data: { status: string; allowedActions: string[]; complianceVerdict: string };
  }>("GET", `/documents/${coaDoc.id}`, sanjay);
  assert(coaDetailBefore.ok, "GET COA detail");
  assert(coaDetailBefore.data!.data.status === "AUTO_GENERATED", "COA detail status");
  assert(
    coaDetailBefore.data!.data.allowedActions.includes("SIGN_AND_ISSUE"),
    "SIGN_AND_ISSUE allowed",
  );
  assert(coaDetailBefore.data!.data.complianceVerdict === "COMPLIES", "COA detail verdict");

  const signIssue = await api<{ data: { status: string } }>(
    "POST",
    `/documents/${coaDoc.id}/sign-and-issue`,
    sanjay,
    { password: PASSWORD },
  );
  assert(signIssue.ok, "sign-and-issue succeeds");
  assert(signIssue.data!.data.status === "ISSUED", "COA ISSUED");

  const batchReleased = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
  assert(batchReleased.status === BatchStatus.RELEASED, "batch RELEASED");
  assert(batchReleased.releasedAt != null, "released_at set");
  assert(batchReleased.currentDocPhase === DocPhase.RELEASED, "phase RELEASED");

  const signIssueAudit = await prisma.auditLog.findFirst({
    where: { entityId: coaDoc.id, action: "SIGN_ISSUE" },
    orderBy: { createdAt: "desc" },
  });
  assert(signIssueAudit != null, "SIGN_ISSUE audit");
  console.log("  OK\n");

  // Check 7: COA_NOT_SIGNABLE on wrong status
  console.log("Check 7: sign-and-issue on ISSUED COA → 409...");
  const notSignable = await api("POST", `/documents/${coaDoc.id}/sign-and-issue`, sanjay, {
    password: PASSWORD,
  });
  assert(!notSignable.ok && notSignable.status === 409, "409 on ISSUED COA");
  assert(notSignable.body?.includes("COA_NOT_SIGNABLE"), "COA_NOT_SIGNABLE code");
  console.log("  OK\n");

  // Check 8: Immutability — generic transition on ISSUED COA
  console.log("Check 8: transition on ISSUED COA rejected...");
  const illegalTransition = await api("POST", `/documents/${coaDoc.id}/submit`, kavya, {
    password: PASSWORD,
  });
  assert(!illegalTransition.ok, "no workflow on COA");
  console.log("  OK\n");

  // Check 10: PDF stub no-op
  console.log("Check 10: PDF stub is no-op...");
  const fileCount = await prisma.fileAttachment.count();
  assert(fileCount === 0, "no file attachments from PDF stub");
  console.log("  OK\n");

  // Check 9: Full chain milestone note — primary batch reached RELEASED above
  console.log("Check 9: Full chain milestone — batch B-2026-001 reached RELEASED via SPEC→MOA→AWS→COA");
  const specDoc = await prisma.batchDocument.findFirstOrThrow({
    where: { batchId: batch.id, docType: DocType.SPEC },
  });
  const moaDoc = await prisma.batchDocument.findFirstOrThrow({
    where: { batchId: batch.id, docType: DocType.MOA },
  });
  assert(specDoc.status === DocStatus.QA_SIGNED, "SPEC QA_SIGNED");
  assert(moaDoc.status === DocStatus.QA_SIGNED, "MOA QA_SIGNED");
  assert(awsDoc.id && (await prisma.batchDocument.findUniqueOrThrow({ where: { id: awsDoc.id } })).status === DocStatus.QA_SIGNED, "AWS QA_SIGNED");
  assert((await prisma.batchDocument.findUniqueOrThrow({ where: { id: coaDoc.id } })).status === DocStatus.ISSUED, "COA ISSUED");
  console.log("  MILESTONE OK — Phase 1 document spine demonstrated\n");

  console.log("All Epic 12c checks passed.");
  console.log("Run verify-epic12a.ts and verify-epic12b.ts after re-seed for regression.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
