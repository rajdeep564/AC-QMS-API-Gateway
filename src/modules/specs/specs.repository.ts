import {
  Operator,
  Prisma,
  ResultType,
  SpecVariant,
  StandingDocStatus,
} from "@prisma/client";
import { Db, prisma } from "../../lib/prisma-types";

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
  conclusionTemplate?: string | null;
  additionalNotes?: string | null;
};

const specDetailInclude = {
  specTests: { orderBy: { sortOrder: "asc" as const } },
  moaDoc: {
    include: {
      sections: {
        include: { specTest: true },
      },
    },
  },
} satisfies Prisma.SpecInclude;

export type SpecWithDetails = Prisma.SpecGetPayload<{ include: typeof specDetailInclude }>;

export async function findSpecById(specId: string, client: Db = prisma) {
  return client.spec.findUnique({ where: { id: specId } });
}

export async function findSpecWithDetails(specId: string, client: Db = prisma): Promise<SpecWithDetails | null> {
  return client.spec.findUnique({
    where: { id: specId },
    include: specDetailInclude,
  });
}

export async function listSpecsByProduct(productId: string, client: Db = prisma) {
  return client.spec.findMany({
    where: { productId },
    orderBy: [{ revisionNo: "desc" }, { createdAt: "desc" }],
    include: {
      specTests: { select: { id: true }, take: 1 },
      moaDoc: { select: { id: true, status: true } },
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

export async function findBatchReadySpec(
  productId: string,
  variant: SpecVariant = SpecVariant.GENERAL,
  client: Db = prisma,
) {
  return client.spec.findFirst({
    where: {
      productId,
      variant,
      status: StandingDocStatus.QA_SIGNED,
    },
    orderBy: { revisionNo: "desc" },
  });
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

export async function updateSpecAndMoaStatus(
  specId: string,
  data: StandingSpecStatusUpdate,
  client: Db = prisma,
) {
  const spec = await client.spec.update({
    where: { id: specId },
    data: {
      status: data.status,
      submittedById: data.submittedById,
      qcApprovedById: data.qcApprovedById,
      qaSignedById: data.qaSignedById,
      approvedAt: data.approvedAt,
      effectiveDate: data.effectiveDate,
    },
    include: specDetailInclude,
  });

  await client.moaDoc.update({
    where: { specId },
    data: { status: data.status },
  });

  return spec;
}

export async function supersedeSpecPair(specId: string, client: Db = prisma) {
  await client.spec.update({
    where: { id: specId },
    data: { status: StandingDocStatus.SUPERSEDED },
  });
  await client.moaDoc.update({
    where: { specId },
    data: { status: StandingDocStatus.SUPERSEDED },
  });
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
            pharmacopoeia: s.pharmacopoeia ?? null,
            samplePreparation: s.samplePreparation ?? null,
            standardPreparation: s.standardPreparation ?? null,
            blankPreparation: s.blankPreparation ?? null,
            conclusionTemplate: s.conclusionTemplate ?? null,
            additionalNotes: s.additionalNotes ?? null,
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
        pharmacopoeia: s.pharmacopoeia ?? null,
        samplePreparation: s.samplePreparation ?? null,
        standardPreparation: s.standardPreparation ?? null,
        blankPreparation: s.blankPreparation ?? null,
        conclusionTemplate: s.conclusionTemplate ?? null,
        additionalNotes: s.additionalNotes ?? null,
      };
    }),
  });

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
          conclusionTemplate: s.conclusionTemplate,
          additionalNotes: s.additionalNotes,
        })),
      },
    },
  });

  return findSpecWithDetails(newSpec.id, client);
}
