/**
 * Epic 12b integration verification — requires seed + dev server on :4000
 */
import { PrismaClient, SectionStatus } from "@prisma/client";

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
  const kavya = await login("kavya.patel");
  const meera = await login("meera.iyer");

  const batch = await prisma.batch.findUniqueOrThrow({ where: { batchNo: "B-2026-001" } });
  const awsDoc = await prisma.batchDocument.findFirstOrThrow({
    where: { batchId: batch.id, docType: "AWS" },
  });

  const listRes = await api<{
    data: {
      sections: { id: string; testName: string; status: string }[];
      allSectionsComplete: boolean;
    };
  }>("GET", `/aws/${awsDoc.id}/sections`, kavya);
  assert(listRes.ok, "list sections wrapper");
  assert(listRes.data!.data.allSectionsComplete === false, "initial readiness false");

  const desc = listRes.data!.data.sections.find((s) => s.testName === "Description")!;
  const assay = listRes.data!.data.sections.find((s) => s.testName === "Assay")!;
  const otherSections = listRes.data!.data.sections.filter(
    (s) => s.testName !== "Description" && s.testName !== "Assay",
  );

  const emptyComplete = await api("POST", `/aws-sections/${desc.id}/complete`, kavya);
  assert(!emptyComplete.ok && emptyComplete.status === 422, "SECTION_INCOMPLETE");

  await api("PATCH", `/aws-sections/${desc.id}`, kavya, {
    observations: { passFail: "PASS" },
  });

  const completeDesc = await api<{ data: { status: string; analyzedById: string } }>(
    "POST",
    `/aws-sections/${desc.id}/complete`,
    kavya,
  );
  assert(completeDesc.ok, "complete Description");
  assert(completeDesc.data!.data.status === SectionStatus.AWAITING_CHECK, "AWAITING_CHECK");

  const lockPatch = await api("PATCH", `/aws-sections/${desc.id}`, kavya, {
    observations: { passFail: "FAIL" },
  });
  assert(!lockPatch.ok && lockPatch.status === 409, "SECTION_LOCKED on AWAITING_CHECK");

  const selfCheck = await api("POST", `/aws-sections/${desc.id}/check`, kavya, {
    password: PASSWORD,
  });
  assert(!selfCheck.ok && selfCheck.status === 403, "SAME_AS_ANALYST");
  assert(selfCheck.body?.includes("SAME_AS_ANALYST"), "SAME_AS_ANALYST code");

  await api("POST", `/aws-sections/${desc.id}/check`, meera, { password: PASSWORD });

  const expiredInst = await prisma.instrument.findUniqueOrThrow({
    where: { instrumentCode: "INST-PH-EXP" },
  });

  await api("PATCH", `/aws-sections/${assay.id}`, kavya, {
    observations: {
      variables: { sample_titrant_volume: 24.5, std_titrant_volume: 24.5, std_concentration: 1.0042 },
    },
    instrumentId: expiredInst.id,
  });

  const completeExpired = await api("POST", `/aws-sections/${assay.id}/complete`, kavya);
  assert(!completeExpired.ok && completeExpired.status === 409, "EXPIRED_NOT_ACKNOWLEDGED");

  const emptyAck = await api("POST", `/aws-sections/${assay.id}/acknowledge-expired`, kavya, {
    type: "instrument",
    comment: "",
  });
  assert(!emptyAck.ok && emptyAck.status === 422, "empty comment rejected");

  await api("POST", `/aws-sections/${assay.id}/acknowledge-expired`, kavya, {
    type: "instrument",
    comment: "Used with QA approval for demo batch",
  });

  await api("PATCH", `/aws-sections/${assay.id}`, kavya, {
    observations: {
      variables: { sample_titrant_volume: 20, std_titrant_volume: 24.5, std_concentration: 1.0 },
    },
  });

  const oosComplete = await api("POST", `/aws-sections/${assay.id}/complete`, kavya);
  assert(!oosComplete.ok && oosComplete.status === 409, "OOS_NOT_ACKNOWLEDGED");

  await api("POST", `/aws-sections/${assay.id}/acknowledge-oos`, kavya, {
    comment: "Investigation initiated",
  });

  let assayRow = await prisma.awsSection.findUniqueOrThrow({ where: { id: assay.id } });
  assert(assayRow.oosAcknowledged === true, "OOS acknowledged");

  await api("PATCH", `/aws-sections/${assay.id}`, kavya, {
    observations: {
      variables: { sample_titrant_volume: 24.5, std_titrant_volume: 24.5, std_concentration: 1.0042 },
    },
  });

  assayRow = await prisma.awsSection.findUniqueOrThrow({ where: { id: assay.id } });
  assert(assayRow.oosAcknowledged === false, "OOS ack cleared on in-spec edit");

  await api("POST", `/aws-sections/${assay.id}/complete`, kavya);

  const rejectCheck = await api<{ data: { status: string; observations: unknown } }>(
    "POST",
    `/aws-sections/${assay.id}/reject-check`,
    meera,
    { comment: "Please verify titrant calibration" },
  );
  assert(rejectCheck.ok, "reject-check");
  assert(rejectCheck.data!.data.status === SectionStatus.IN_PROGRESS, "back to IN_PROGRESS");
  assert(rejectCheck.data!.data.observations != null, "observations retained");

  await api("PATCH", `/aws-sections/${assay.id}`, kavya, {
    observations: {
      variables: { sample_titrant_volume: 24.5, std_titrant_volume: 24.5, std_concentration: 1.0042 },
    },
  });
  await api("POST", `/aws-sections/${assay.id}/complete`, kavya);
  await api("POST", `/aws-sections/${assay.id}/check`, meera, { password: PASSWORD });

  for (const section of otherSections) {
    await api("PATCH", `/aws-sections/${section.id}`, kavya, {
      observations:
        section.testName === "pH" ? { variables: { value: 6.2 } } : { passFail: "PASS" },
    });
    await api("POST", `/aws-sections/${section.id}/complete`, kavya);
    await api("POST", `/aws-sections/${section.id}/check`, meera, { password: PASSWORD });
  }

  const finalList = await api<{ data: { allSectionsComplete: boolean } }>(
    "GET",
    `/aws/${awsDoc.id}/sections`,
    kavya,
  );
  assert(finalList.data!.data.allSectionsComplete === true, "all sections complete");

  console.log("Epic 12b integration verification passed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
