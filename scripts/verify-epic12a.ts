/**
 * Epic 12a integration verification — requires DB + dev server on :4000
 * Run: npm run seed && npm run dev (separate terminal) && npx tsx scripts/verify-epic12a.ts
 */
import { Conclusion, DocStatus, Operator, PrismaClient, ResultType, SectionStatus } from "@prisma/client";
import { evaluateQuantitativeConclusion } from "../src/services/conclusion-evaluator";

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
  console.log("Conclusion evaluator unit checks...");
  const betweenOk = evaluateQuantitativeConclusion(6.2, {
    resultType: ResultType.QUANTITATIVE,
    operator: Operator.BETWEEN,
    minValue: 5.5,
    maxValue: 7.0,
  });
  assert(betweenOk.conclusion === Conclusion.SATISFACTORY, "BETWEEN in-range");
  const betweenBad = evaluateQuantitativeConclusion(7.5, {
    resultType: ResultType.QUANTITATIVE,
    operator: Operator.BETWEEN,
    minValue: 5.5,
    maxValue: 7.0,
  });
  assert(betweenBad.conclusion === Conclusion.NOT_SATISFACTORY, "BETWEEN out-of-range");
  const nltOk = evaluateQuantitativeConclusion(99.0, {
    resultType: ResultType.QUANTITATIVE,
    operator: Operator.NLT,
    minValue: 98.5,
    maxValue: null,
  });
  assert(nltOk.conclusion === Conclusion.SATISFACTORY, "NLT in-range");
  const nmtOk = evaluateQuantitativeConclusion(0.5, {
    resultType: ResultType.QUANTITATIVE,
    operator: Operator.NMT,
    minValue: null,
    maxValue: 1.0,
  });
  assert(nmtOk.conclusion === Conclusion.SATISFACTORY, "NMT in-range");
  const unboundedBetween = evaluateQuantitativeConclusion(1.0, {
    resultType: ResultType.QUANTITATIVE,
    operator: Operator.BETWEEN,
    minValue: null,
    maxValue: null,
  });
  assert(
    unboundedBetween.conclusion === Conclusion.SATISFACTORY,
    "BETWEEN with no bounds is satisfactory (customer-requirement tests)",
  );
  console.log("  PASS: BETWEEN/NMT/NLT conclusion rules\n");

  const kavya = await login("kavya.patel");
  const meera = await login("meera.iyer");

  const batch = await prisma.batch.findUniqueOrThrow({ where: { batchNo: "B-2026-001" } });
  const awsDoc = await prisma.batchDocument.findFirstOrThrow({
    where: { batchId: batch.id, docType: "AWS" },
  });
  assert(awsDoc.status === DocStatus.DRAFT, "AWS doc is DRAFT after seed");
  assert(batch.currentDocPhase === "AWS", "batch phase is AWS");

  const sectionsRes = await api<{ data: { sections: { id: string; testName: string; status: string; observations: unknown }[] } }>(
    "GET",
    `/aws/${awsDoc.id}/sections`,
    kavya,
  );
  assert(sectionsRes.ok, "list sections");
  assert(sectionsRes.data!.data.sections.length === 4, "4 sections with Assay activated");
  assert(
    sectionsRes.data!.data.sections.every((s) => s.status === SectionStatus.NOT_STARTED && !s.observations),
    "sections NOT_STARTED and empty",
  );

  const assay = sectionsRes.data!.data.sections.find((s) => s.testName === "Assay")!;
  const ph = sectionsRes.data!.data.sections.find((s) => s.testName === "pH")!;
  const desc = sectionsRes.data!.data.sections.find((s) => s.testName === "Description")!;

  const smuggle = await api(
    "PATCH",
    `/aws-sections/${assay.id}`,
    kavya,
    {
      observations: {
        variables: { sample_titrant_volume: 24.5, std_titrant_volume: 24.5, std_concentration: 1.0042 },
      },
      calculatedResult: 999.99,
    } as never,
  );
  assert(!smuggle.ok && smuggle.status === 422, "smuggled calculatedResult rejected by strict schema");

  const inLimit = await api<{ data: { calculatedResult: string; resultDisplay: string; conclusion: string; status: string } }>(
    "PATCH",
    `/aws-sections/${assay.id}`,
    kavya,
    {
      observations: {
        variables: { sample_titrant_volume: 24.5, std_titrant_volume: 24.5, std_concentration: 1.0042 },
      },
    },
  );
  assert(inLimit.ok, "Assay PATCH in-limit");
  assert(inLimit.data!.data.status === SectionStatus.IN_PROGRESS, "status IN_PROGRESS");
  assert(inLimit.data!.data.resultDisplay === "100.42", "resultDisplay formatted");
  assert(inLimit.data!.data.conclusion === "SATISFACTORY", "Assay SATISFACTORY in-limit");
  assert(inLimit.data!.data.calculatedResult !== "999.99", "stored result is backend value not client");

  const outLimit = await api<{ data: { conclusion: string; oosDetected: boolean } }>(
    "PATCH",
    `/aws-sections/${assay.id}`,
    kavya,
    {
      observations: {
        variables: { sample_titrant_volume: 20, std_titrant_volume: 24.5, std_concentration: 1.0 },
      },
    },
  );
  assert(outLimit.ok, "Assay PATCH out-of-limit");
  assert(outLimit.data!.data.conclusion === "NOT_SATISFACTORY", "Assay NOT_SATISFACTORY out-of-limit");
  assert(outLimit.data!.data.oosDetected === true, "provisional oosDetected");

  const phIn = await api<{ data: { conclusion: string; resultDisplay: string } }>(
    "PATCH",
    `/aws-sections/${ph.id}`,
    kavya,
    { observations: { variables: { value: 6.2 } } },
  );
  assert(phIn.ok, "pH PATCH in-range");
  assert(phIn.data!.data.conclusion === "SATISFACTORY", "pH BETWEEN SATISFACTORY");

  const phOut = await api<{ data: { conclusion: string } }>(
    "PATCH",
    `/aws-sections/${ph.id}`,
    kavya,
    { observations: { variables: { value: 7.5 } } },
  );
  assert(phOut.ok, "pH PATCH out-of-range");
  assert(phOut.data!.data.conclusion === "NOT_SATISFACTORY", "pH BETWEEN NOT_SATISFACTORY");

  const qual = await api<{ data: { conclusion: string } }>("PATCH", `/aws-sections/${desc.id}`, kavya, {
    observations: { passFail: "PASS" },
  });
  assert(qual.ok, "Description qualitative PATCH");
  assert(qual.data!.data.conclusion === "PASS", "Description conclusion PASS");

  const preview = await api<{ data: { resultDisplay: string; conclusion: string } }>(
    "POST",
    `/aws-sections/${assay.id}/preview`,
    kavya,
    {
      observations: {
        variables: { sample_titrant_volume: 24.5, std_titrant_volume: 24.5, std_concentration: 1.0042 },
      },
    },
  );
  assert(preview.ok, "preview endpoint");
  assert(preview.data!.data.resultDisplay === "100.42", "preview matches PATCH result");

  const dbBefore = await prisma.awsSection.findUniqueOrThrow({ where: { id: assay.id } });
  await api("POST", `/aws-sections/${assay.id}/preview`, kavya, {
    observations: { variables: { sample_titrant_volume: 1, std_titrant_volume: 1, std_concentration: 1 } },
  });
  const dbAfter = await prisma.awsSection.findUniqueOrThrow({ where: { id: assay.id } });
  assert(
    dbBefore.calculatedResult?.toString() === dbAfter.calculatedResult?.toString(),
    "preview does not persist",
  );

  const detail = await api<{ data: { limits: { specDocumentTestId: string; minValue: string } } }>(
    "GET",
    `/aws-sections/${assay.id}`,
    kavya,
  );
  assert(detail.ok, "section detail");
  const specTest = await prisma.specDocumentTest.findUniqueOrThrow({
    where: { id: detail.data!.data.limits.specDocumentTestId! },
  });
  assert(detail.data!.data.limits.minValue === specTest.minValue?.toString(), "limits from frozen spec_document_test");
  assert(Number(specTest.minValue) === 98.5, "Assay NLT min 98.5 from SPEC");

  const notAssignee = await api("PATCH", `/aws-sections/${assay.id}`, meera, {
    observations: { passFail: "PASS" },
  });
  assert(!notAssignee.ok && notAssignee.status === 403, "non-assignee 403");
  assert(notAssignee.body?.includes("SECTION_NOT_ASSIGNEE"), "SECTION_NOT_ASSIGNEE code");

  console.log("Epic 12a integration verification passed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
