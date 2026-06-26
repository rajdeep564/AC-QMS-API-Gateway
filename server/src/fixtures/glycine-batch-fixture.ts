import {
  BatchStatus,
  DocPhase,
  DocStatus,
  DocType,
  PrismaClient,
  Role,
} from "@prisma/client";
import { checkAwsSection, completeAwsSection } from "../modules/aws/aws-compliance.service";
import { patchAwsSection } from "../modules/aws/aws.service";
import { populateSpecDocument } from "../modules/documents/documents.service";
import { signAndIssueCoa } from "../modules/documents/documents.service";
import { transition } from "../services/workflow-engine";
import type { JwtAccessPayload } from "../types/auth.types";

export const SEED_GLYCINE_BATCH_NO = "B-2026-001";
export const GLYCINE_BATCH_DEV_PASSWORD = "Acqms@2026";

const prisma = new PrismaClient();

export async function resetGlycineBatchDocuments(batchId: string): Promise<void> {
  const docs = await prisma.batchDocument.findMany({ where: { batchId } });
  const docIds = docs.map((doc) => doc.id);

  await prisma.specDocumentTest.deleteMany({
    where: { batchDocumentId: { in: docIds } },
  });
  await prisma.moaDocumentSection.deleteMany({
    where: { batchDocumentId: { in: docIds } },
  });
  await prisma.awsSection.deleteMany({
    where: { batchDocumentId: { in: docIds } },
  });
  await prisma.coaResult.deleteMany({
    where: { batchDocumentId: { in: docIds } },
  });

  const userIds = (
    await prisma.user.findMany({
      where: {
        username: {
          in: ["kavya.patel", "priya.mehta", "sanjay.reddy", "meera.iyer", "diya.sharma"],
        },
      },
      select: { id: true },
    })
  ).map((u) => u.id);
  if (userIds.length > 0) {
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  }

  for (const doc of docs) {
    await prisma.batchDocument.update({
      where: { id: doc.id },
      data: {
        status: DocStatus.PENDING,
        optionalTestsActivated: [],
        complianceVerdict: null,
        createdById: null,
        submittedById: null,
        submittedAt: null,
        qcApprovedById: null,
        qcApprovedAt: null,
        qaSignedById: null,
        qaSignedAt: null,
        rejectionComment: null,
        rejectedById: null,
        rejectedAt: null,
      },
    });
  }

  await prisma.batch.update({
    where: { id: batchId },
    data: {
      currentDocPhase: DocPhase.SPEC,
      status: BatchStatus.ACTIVE,
      releasedAt: null,
    },
  });
}

export async function advanceGlycineBatchToAwsDraft(
  batchId: string,
  templateId: string,
  kavya: { id: string },
  priya: { id: string },
  sanjay: { id: string },
  qcDeptId: string,
): Promise<void> {
  const awsDoc = await prisma.batchDocument.findFirst({
    where: { batchId, docType: DocType.AWS },
  });

  if (awsDoc?.status === DocStatus.DRAFT) {
    console.log("  Batch already at AWS DRAFT — skipping workflow advance.");
    return;
  }

  const assayTemplateTest = await prisma.specTemplateTest.findFirst({
    where: {
      specTemplateId: templateId,
      testParameter: { testName: "Assay" },
    },
  });

  const kavyaActor: JwtAccessPayload = {
    userId: kavya.id,
    role: Role.QC_EXEC,
    departmentId: qcDeptId,
  };
  const priyaActor: JwtAccessPayload = {
    userId: priya.id,
    role: Role.QC_MGR,
    departmentId: qcDeptId,
  };
  const sanjayActor: JwtAccessPayload = {
    userId: sanjay.id,
    role: Role.QA_MGR,
    departmentId: qcDeptId,
  };

  await populateSpecDocument(
    batchId,
    { optionalTestIds: assayTemplateTest ? [assayTemplateTest.id] : [] },
    kavyaActor,
  );

  const docs = await prisma.batchDocument.findMany({ where: { batchId } });
  const specDoc = docs.find((d) => d.docType === DocType.SPEC)!;
  const moaDoc = docs.find((d) => d.docType === DocType.MOA)!;

  for (const step of [
    { entityType: "SPEC_DOCUMENT" as const, entityId: specDoc.id },
    { entityType: "MOA_DOCUMENT" as const, entityId: moaDoc.id },
  ]) {
    await transition({
      ...step,
      action: "SUBMIT",
      actor: kavyaActor,
      password: GLYCINE_BATCH_DEV_PASSWORD,
    });
    await transition({
      ...step,
      action: "APPROVE",
      actor: priyaActor,
      password: GLYCINE_BATCH_DEV_PASSWORD,
    });
    await transition({
      ...step,
      action: "SIGN",
      actor: sanjayActor,
      password: GLYCINE_BATCH_DEV_PASSWORD,
    });
  }

  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
  const finalAws = await prisma.batchDocument.findFirst({
    where: { batchId, docType: DocType.AWS },
  });
  const sectionCount = await prisma.awsSection.count({
    where: { batchDocumentId: finalAws!.id },
  });
  console.log(
    `  Advanced batch to AWS DRAFT (phase=${batch.currentDocPhase}, ${sectionCount} sections).`,
  );
}

async function completeAllAwsSectionsForRelease(
  awsDocId: string,
  kavyaActor: JwtAccessPayload,
  meeraActor: JwtAccessPayload,
): Promise<void> {
  const sections = await prisma.awsSection.findMany({
    where: { batchDocumentId: awsDocId },
    include: { testParameter: true, specDocumentTest: true },
    orderBy: { sortOrder: "asc" },
  });

  for (const section of sections) {
    const testName = section.specDocumentTest?.testName ?? section.testParameter.testName;

    if (testName === "Assay") {
      await patchAwsSection(
        section.id,
        {
          observations: {
            variables: {
              sample_titrant_volume: 24.5,
              std_titrant_volume: 24.5,
              std_concentration: 1.0042,
            },
          },
        },
        kavyaActor,
      );
    } else if (testName === "pH") {
      await patchAwsSection(
        section.id,
        { observations: { variables: { value: 6.2 } } },
        kavyaActor,
      );
    } else {
      await patchAwsSection(
        section.id,
        { observations: { passFail: "PASS" } },
        kavyaActor,
      );
    }

    await completeAwsSection(section.id, kavyaActor);
    await checkAwsSection(section.id, { password: GLYCINE_BATCH_DEV_PASSWORD }, meeraActor);
  }
}

export async function advanceGlycineBatchToReleased(
  batchId: string,
  kavya: { id: string },
  meera: { id: string },
  priya: { id: string },
  sanjay: { id: string },
  qcDeptId: string,
): Promise<void> {
  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
  if (batch.status === BatchStatus.RELEASED) {
    console.log("  Batch already RELEASED — skipping release advance.");
    return;
  }

  const awsDoc = await prisma.batchDocument.findFirst({
    where: { batchId, docType: DocType.AWS },
  });
  if (!awsDoc || awsDoc.status !== DocStatus.DRAFT) {
    throw new Error("Batch must be at AWS DRAFT before advancing to RELEASED");
  }

  const kavyaActor: JwtAccessPayload = {
    userId: kavya.id,
    role: Role.QC_EXEC,
    departmentId: qcDeptId,
  };
  const meeraActor: JwtAccessPayload = {
    userId: meera.id,
    role: Role.QC_EXEC,
    departmentId: qcDeptId,
  };
  const priyaActor: JwtAccessPayload = {
    userId: priya.id,
    role: Role.QC_MGR,
    departmentId: qcDeptId,
  };
  const sanjayActor: JwtAccessPayload = {
    userId: sanjay.id,
    role: Role.QA_MGR,
    departmentId: qcDeptId,
  };

  await completeAllAwsSectionsForRelease(awsDoc.id, kavyaActor, meeraActor);

  await transition({
    entityType: "AWS_DOCUMENT",
    entityId: awsDoc.id,
    action: "SUBMIT",
    actor: kavyaActor,
    password: GLYCINE_BATCH_DEV_PASSWORD,
  });
  await transition({
    entityType: "AWS_DOCUMENT",
    entityId: awsDoc.id,
    action: "APPROVE",
    actor: priyaActor,
    password: GLYCINE_BATCH_DEV_PASSWORD,
  });
  await transition({
    entityType: "AWS_DOCUMENT",
    entityId: awsDoc.id,
    action: "SIGN",
    actor: sanjayActor,
    password: GLYCINE_BATCH_DEV_PASSWORD,
  });

  const coaDoc = await prisma.batchDocument.findFirstOrThrow({
    where: { batchId, docType: DocType.COA },
  });

  await signAndIssueCoa(coaDoc.id, sanjayActor, GLYCINE_BATCH_DEV_PASSWORD);

  await prisma.batch.update({
    where: { id: batchId },
    data: { customerName: "Demo Customer Ltd" },
  });

  console.log("  Advanced batch to RELEASED with issued COA.");
}

/** Reset B-2026-001 to AWS DRAFT when verify scripts need in-flight workflow state. */
export async function ensureGlycineBatchAtAwsDraftForVerification(
  kavya: { id: string },
  priya: { id: string },
  sanjay: { id: string },
  qcDeptId: string,
): Promise<void> {
  const batch = await prisma.batch.findUnique({
    where: { batchNo: SEED_GLYCINE_BATCH_NO },
  });
  if (!batch) return;

  const awsDoc = await prisma.batchDocument.findFirst({
    where: { batchId: batch.id, docType: DocType.AWS },
  });

  if (batch.status === BatchStatus.RELEASED || awsDoc?.status !== DocStatus.DRAFT) {
    console.log("  Resetting B-2026-001 to AWS DRAFT for verification...");
    await resetGlycineBatchDocuments(batch.id);
    await advanceGlycineBatchToAwsDraft(
      batch.id,
      batch.specTemplateId,
      kavya,
      priya,
      sanjay,
      qcDeptId,
    );
  }
}

export async function disconnectGlycineFixturePrisma(): Promise<void> {
  await prisma.$disconnect();
}
