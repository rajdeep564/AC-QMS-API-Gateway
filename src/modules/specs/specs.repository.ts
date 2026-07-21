import {
  Operator,
  Prisma,
  ResultType,
  SpecVariant,
  StandingDocStatus,
} from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { Db, prisma } from "../../lib/prisma-types";
import { AuditAction, AuditEntityType, type AuditInput, log as auditLog } from "../../services/audit.service";
import { moaSectionContentFields } from "./specs.moa-mapper";

export type SpecTestInput = {
  sortOrder: number;
  testName: string;
  resultType: ResultType;
  operator?: Operator | null;
  minValue?: number | string | null;
  maxValue?: number | string | null;
  uom?: string | null;
  acceptanceCriteria?: string | null;
  formula?: string | null;
  formulaVariables?: Prisma.InputJsonValue | null;
  isOptional?: boolean;
  isOutsideLab?: boolean;
};

export type MoaSectionInput = {
  specTestRef: number;
  pharmacopoeia?: string | null;
  samplePreparation?: string | null;
  standardPreparation?: string | null;
  blankPreparation?: string | null;
  reagentPreparation?: string | null;
  instrumentParameters?: string | null;
  systemSuitability?: string | null;
  sequenceTable?: string | null;
  procedureText?: string | null;
  formulaReference?: string | null;
  conclusionTemplate?: string | null;
  additionalNotes?: string | null;
};

const specDetailInclude = {
  product: { select: { id: true, name: true } },
  specTests: { orderBy: { sortOrder: "asc" as const } },
  createdBy: { select: { id: true, fullName: true, role: true } },
  submittedBy: { select: { id: true, fullName: true, role: true } },
  qcApprovedBy: { select: { id: true, fullName: true, role: true } },
  qaSignedBy: { select: { id: true, fullName: true, role: true } },
  moaDoc: {
    include: {
      sections: {
        include: { specTest: true },
      },
    },
  },
} satisfies Prisma.SpecInclude;

export type SpecWithDetails = Prisma.SpecGetPayload<{ include: typeof specDetailInclude }>;

/** Alias for Epic 21 standing-document render loader. */
export async function findSpecWithMoaForRender(specId: string, client: Db = prisma) {
  return findSpecWithDetails(specId, client);
}

export async function findSpecById(specId: string, client: Db = prisma) {
  return client.spec.findUnique({ where: { id: specId } });
}

export async function findSpecWithDetails(specId: string, client: Db = prisma): Promise<SpecWithDetails | null> {
  return client.spec.findUnique({
    where: { id: specId },
    include: specDetailInclude,
  });
}

export async function listSpecsByProduct(
  productId: string,
  status?: StandingDocStatus,
  client: Db = prisma,
) {
  return client.spec.findMany({
    where: {
      productId,
      ...(status ? { status } : {}),
    },
    orderBy: [{ revisionNo: "desc" }, { createdAt: "desc" }],
    include: {
      specTests: { select: { id: true }, take: 1 },
      moaDoc: { select: { id: true, status: true } },
    },
  });
}

export async function listSubmittedSpecsForQcApproval(
  excludeCreatedByUserId?: string,
  client: Db = prisma,
) {
  return client.spec.findMany({
    where: {
      status: StandingDocStatus.SUBMITTED,
      ...(excludeCreatedByUserId ? { createdById: { not: excludeCreatedByUserId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      product: { select: { id: true, name: true } },
      submittedBy: { select: { username: true, fullName: true } },
      createdBy: { select: { username: true, fullName: true } },
      moaDoc: { select: { moaNo: true } },
    },
  });
}

export async function listQcApprovedSpecsForQaSignature(client: Db = prisma) {
  return client.spec.findMany({
    where: { status: StandingDocStatus.QC_APPROVED },
    orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
    include: {
      product: { select: { id: true, name: true } },
      qcApprovedBy: { select: { username: true, fullName: true } },
      moaDoc: { select: { moaNo: true } },
    },
  });
}

export async function aggregateRevisionNo(
  productId: string,
  variant: SpecVariant,
  client: Db = prisma,
) {
  return client.spec.aggregate({
    where: { productId, variant },
    _max: { revisionNo: true },
  });
}

/** QA_SIGNED SPECs for batch selection (C-1). Newest revision first. */
export async function listActiveSpecs(
  productId: string,
  variant: SpecVariant = SpecVariant.GENERAL,
  client: Db = prisma,
) {
  return client.spec.findMany({
    where: {
      productId,
      variant,
      status: StandingDocStatus.QA_SIGNED,
    },
    orderBy: [{ revisionNo: "desc" }, { approvedAt: "desc" }],
    select: {
      id: true,
      productId: true,
      variant: true,
      specNo: true,
      revisionNo: true,
      status: true,
      effectiveDate: true,
      approvedAt: true,
      createdAt: true,
    },
  });
}

export async function findActiveSpecById(
  productId: string,
  specId: string,
  variant: SpecVariant = SpecVariant.GENERAL,
  client: Db = prisma,
) {
  return client.spec.findFirst({
    where: {
      id: specId,
      productId,
      variant,
      status: StandingDocStatus.QA_SIGNED,
    },
  });
}

export async function findBatchReadySpec(
  productId: string,
  variant: SpecVariant = SpecVariant.GENERAL,
  client: Db = prisma,
) {
  const active = await listActiveSpecs(productId, variant, client);
  return active[0] ?? null;
}

export async function findInFlightRevision(
  productId: string,
  variant: SpecVariant,
  client: Db = prisma,
) {
  return client.spec.findFirst({
    where: {
      productId,
      variant,
      status: {
        in: [
          StandingDocStatus.DRAFT,
          StandingDocStatus.SUBMITTED,
          StandingDocStatus.QC_APPROVED,
        ],
      },
    },
  });
}

export async function countQaSignedSpecs(
  productId: string,
  variant: SpecVariant,
  exceptSpecId?: string,
  client: Db = prisma,
) {
  return client.spec.count({
    where: {
      productId,
      variant,
      status: StandingDocStatus.QA_SIGNED,
      ...(exceptSpecId ? { id: { not: exceptSpecId } } : {}),
    },
  });
}

export async function countSpecTests(specId: string, client: Db = prisma) {
  return client.specTest.count({ where: { specId } });
}

export async function hasMoaWithSections(specId: string, client: Db = prisma) {
  const moa = await client.moaDoc.findUnique({
    where: { specId },
    include: { _count: { select: { sections: true } } },
  });
  return moa !== null && moa._count.sections > 0;
}

export type StandingSpecStatusUpdate = {
  status: StandingDocStatus;
  submittedById?: string | null;
  qcApprovedById?: string | null;
  qaSignedById?: string | null;
  approvedAt?: Date | null;
  effectiveDate?: Date | null;
};

export type StandingSpecStatusAuditContext = AuditInput & {
  oldStatus: StandingDocStatus;
};

/**
 * Lockstep invariant — the ONLY write path for specs.status / moa_docs.status (Epic 4 / US-4-3).
 * Both records always receive the same status value in one call.
 */
export async function updateSpecAndMoaStatus(
  specId: string,
  data: StandingSpecStatusUpdate,
  client: Db = prisma,
  audit?: StandingSpecStatusAuditContext,
) {
  const pairedStatus = data.status;
  if (pairedStatus === undefined || pairedStatus === null) {
    throw AppError.validation("SPEC/MOA status update requires a paired status value");
  }

  const spec = await client.spec.update({
    where: { id: specId },
    data: {
      status: pairedStatus,
      submittedById: data.submittedById,
      qcApprovedById: data.qcApprovedById,
      qaSignedById: data.qaSignedById,
      approvedAt: data.approvedAt,
      effectiveDate: data.effectiveDate,
    },
    include: specDetailInclude,
  });

  const moa = await client.moaDoc.update({
    where: { specId },
    data: { status: pairedStatus },
  });

  if (spec.status !== pairedStatus || moa.status !== pairedStatus) {
    throw AppError.fromCode(
      "INTERNAL",
      "Lockstep invariant violated: SPEC and MOA status must be updated together to the same value",
    );
  }

  if (audit) {
    await auditLog(
      {
        ...audit,
        action: audit.action,
        entityType: audit.entityType ?? AuditEntityType.SPEC,
        entityId: audit.entityId ?? specId,
        fieldChanged: audit.fieldChanged ?? "status",
        oldValue: audit.oldStatus,
        newValue: pairedStatus,
      },
      client,
    );
  }

  return spec;
}

export async function supersedeSpecPair(
  specId: string,
  client: Db = prisma,
  audit?: StandingSpecStatusAuditContext,
) {
  await updateSpecAndMoaStatus(
    specId,
    { status: StandingDocStatus.SUPERSEDED },
    client,
    audit,
  );
}

function mapTestCreate(tests: SpecTestInput[]) {
  return tests.map((t) => ({
    sortOrder: t.sortOrder,
    testName: t.testName,
    resultType: t.resultType,
    operator: t.operator ?? null,
    minValue: t.minValue != null ? new Prisma.Decimal(t.minValue) : null,
    maxValue: t.maxValue != null ? new Prisma.Decimal(t.maxValue) : null,
    uom: t.uom ?? null,
    acceptanceCriteria: t.acceptanceCriteria ?? null,
    formula: t.formula ?? null,
    formulaVariables: t.formulaVariables ?? undefined,
    isOptional: t.isOptional ?? false,
    isOutsideLab: t.isOutsideLab ?? false,
  }));
}

export async function createSpecWithMoaPair(
  data: {
    productId: string;
    variant: SpecVariant;
    specNo: string;
    moaNo: string;
    revisionNo: number;
    createdById: string;
    effectiveDate?: Date;
    tests: SpecTestInput[];
    moaSections: MoaSectionInput[];
  },
  client: Db = prisma,
) {
  const createdTests = mapTestCreate(data.tests);

  const spec = await client.spec.create({
    data: {
      productId: data.productId,
      variant: data.variant,
      specNo: data.specNo,
      revisionNo: data.revisionNo,
      status: StandingDocStatus.DRAFT,
      createdById: data.createdById,
      effectiveDate: data.effectiveDate,
      specTests: { create: createdTests },
    },
    include: { specTests: { orderBy: { sortOrder: "asc" } } },
  });

  const testIds = spec.specTests.map((t) => t.id);

  const moa = await client.moaDoc.create({
    data: {
      specId: spec.id,
      moaNo: data.moaNo,
      revisionNo: data.revisionNo,
      status: StandingDocStatus.DRAFT,
      sections: {
        create: data.moaSections.map((s) => {
          const testId = testIds[s.specTestRef];
          if (!testId) {
            throw new Error(`Invalid specTestRef index: ${s.specTestRef}`);
          }
          return {
            specTestId: testId,
            ...moaSectionContentFields(s),
          };
        }),
      },
    },
  });

  void moa;

  return findSpecWithDetails(spec.id, client);
}

export async function replaceSpecContent(
  specId: string,
  tests: SpecTestInput[],
  moaSections: MoaSectionInput[],
  client: Db = prisma,
  audit?: AuditInput,
) {
  await client.moaDocSection.deleteMany({
    where: { moaDoc: { specId } },
  });
  await client.specTest.deleteMany({ where: { specId } });

  const spec = await client.spec.update({
    where: { id: specId },
    data: {
      specTests: { create: mapTestCreate(tests) },
    },
    include: { specTests: { orderBy: { sortOrder: "asc" } } },
  });

  const testIds = spec.specTests.map((t) => t.id);
  const moa = await client.moaDoc.findUnique({ where: { specId } });
  if (!moa) {
    throw new Error("Paired MOA not found");
  }

  await client.moaDocSection.createMany({
    data: moaSections.map((s) => {
      const testId = testIds[s.specTestRef];
      if (!testId) {
        throw new Error(`Invalid specTestRef index: ${s.specTestRef}`);
      }
      return {
        moaDocId: moa.id,
        specTestId: testId,
        ...moaSectionContentFields(s),
      };
    }),
  });

  if (audit) {
    await auditLog(
      {
        ...audit,
        action: audit.action ?? AuditAction.UPDATE,
        entityType: audit.entityType ?? AuditEntityType.SPEC,
        entityId: audit.entityId ?? specId,
      },
      client,
    );
  }

  return findSpecWithDetails(specId, client);
}

export async function copySpecRevision(
  sourceId: string,
  actorId: string,
  specNo: string,
  moaNo: string,
  client: Db = prisma,
) {
  const source = await findSpecWithDetails(sourceId, client);
  if (!source || !source.moaDoc) {
    throw new Error("Source SPEC with paired MOA not found");
  }

  const newSpec = await client.spec.create({
    data: {
      productId: source.productId,
      variant: source.variant,
      specNo,
      revisionNo: source.revisionNo + 1,
      status: StandingDocStatus.DRAFT,
      supersedesId: source.id,
      createdById: actorId,
      effectiveDate: source.effectiveDate,
      specTests: {
        create: source.specTests.map((t) => ({
          sortOrder: t.sortOrder,
          testName: t.testName,
          resultType: t.resultType,
          operator: t.operator,
          minValue: t.minValue,
          maxValue: t.maxValue,
          uom: t.uom,
          acceptanceCriteria: t.acceptanceCriteria,
          formula: t.formula,
          formulaVariables: t.formulaVariables ?? undefined,
          isOptional: t.isOptional,
          isOutsideLab: t.isOutsideLab,
        })),
      },
    },
    include: { specTests: { orderBy: { sortOrder: "asc" } } },
  });

  const testIdMap = new Map<string, string>();
  source.specTests.forEach((oldTest, i) => {
    testIdMap.set(oldTest.id, newSpec.specTests[i]!.id);
  });

  await client.moaDoc.create({
    data: {
      specId: newSpec.id,
      moaNo,
      revisionNo: newSpec.revisionNo,
      status: StandingDocStatus.DRAFT,
      sections: {
        create: source.moaDoc.sections.map((s) => ({
          specTestId: testIdMap.get(s.specTestId)!,
          pharmacopoeia: s.pharmacopoeia,
          samplePreparation: s.samplePreparation,
          standardPreparation: s.standardPreparation,
          blankPreparation: s.blankPreparation,
          reagentPreparation: s.reagentPreparation,
          instrumentParameters: s.instrumentParameters,
          systemSuitability: s.systemSuitability,
          sequenceTable: s.sequenceTable,
          procedureText: s.procedureText,
          formulaReference: s.formulaReference,
          conclusionTemplate: s.conclusionTemplate,
          additionalNotes: s.additionalNotes,
        })),
      },
    },
  });

  return findSpecWithDetails(newSpec.id, client);
}
