import "dotenv/config";
import bcrypt from "bcrypt";
import {
  BatchStatus,
  DeptName,
  DocPhase,
  DocStatus,
  DocType,
  InstrumentStatus,
  MasterStatus,
  Operator,
  Prisma,
  PrismaClient,
  ProductStatus,
  ReagentStatus,
  ResultType,
  Role,
  TemplateStatus,
  VariantType,
} from "@prisma/client";
import { generateArn } from "../src/services/arn-generator";
import {
  advanceGlycineBatchToAwsDraft,
  advanceGlycineBatchToReleased,
  resetGlycineBatchDocuments,
  SEED_GLYCINE_BATCH_NO,
} from "../src/fixtures/glycine-batch-fixture";
import { computeBatchExpiryDate } from "../src/utils/dates";
import {
  formatBatchAwsDocNo,
  formatBatchCoaDocNo,
  formatBatchMoaDocNo,
  formatBatchSpecDocNo,
} from "../src/utils/doc-number";

const prisma = new PrismaClient();

const DEV_PASSWORD = "Acqms@2026";
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 12);

const DEPARTMENTS: {
  name: DeptName;
  colorHex: string;
  description: string;
}[] = [
  { name: DeptName.QC, colorHex: "#2E7D32", description: "Quality Control" },
  { name: DeptName.QA, colorHex: "#1565C0", description: "Quality Assurance" },
  {
    name: DeptName.MARKETING,
    colorHex: "#6A1B9A",
    description: "Marketing",
  },
];

const USERS: {
  fullName: string;
  username: string;
  role: Role;
  department: DeptName | null;
}[] = [
  { fullName: "Rajesh Kumar", username: "rajesh.kumar", role: Role.SADMIN, department: null },
  { fullName: "Kavya Patel", username: "kavya.patel", role: Role.QC_EXEC, department: DeptName.QC },
  { fullName: "Meera Iyer", username: "meera.iyer", role: Role.QC_EXEC, department: DeptName.QC },
  { fullName: "Priya Mehta", username: "priya.mehta", role: Role.QC_MGR, department: DeptName.QC },
  { fullName: "Anand Joshi", username: "anand.joshi", role: Role.QA_EXEC, department: DeptName.QA },
  { fullName: "Sanjay Reddy", username: "sanjay.reddy", role: Role.QA_MGR, department: DeptName.QA },
  { fullName: "Diya Sharma", username: "diya.sharma", role: Role.MKT_EXEC, department: DeptName.MARKETING },
];

async function seedDepartments() {
  const deptMap = new Map<DeptName, string>();

  for (const dept of DEPARTMENTS) {
    const record = await prisma.department.upsert({
      where: { name: dept.name },
      update: {
        colorHex: dept.colorHex,
        description: dept.description,
      },
      create: {
        name: dept.name,
        colorHex: dept.colorHex,
        description: dept.description,
      },
    });
    deptMap.set(dept.name, record.id);
  }

  return deptMap;
}

async function seedUsers(deptMap: Map<DeptName, string>, passwordHash: string) {
  for (const user of USERS) {
    const departmentId = user.department ? deptMap.get(user.department) ?? null : null;

    await prisma.user.upsert({
      where: { username: user.username },
      update: {
        fullName: user.fullName,
        email: `${user.username}@adityachemicals.test`,
        role: user.role,
        departmentId,
        passwordHash,
        forcePwdChange: true,
        status: "ACTIVE",
        failedAttempts: 0,
        lockedUntil: null,
      },
      create: {
        fullName: user.fullName,
        username: user.username,
        email: `${user.username}@adityachemicals.test`,
        passwordHash,
        role: user.role,
        departmentId,
        forcePwdChange: true,
      },
    });
  }
}

const SEED_GLYCINE_GENERAL_TEMPLATE_NO = "SPEC-TPL/GLC/GEN/001";

const GLYCINE_TESTS = [
  {
    sortOrder: 1,
    testName: "Description",
    isMandatory: true,
    resultType: ResultType.QUALITATIVE,
    acceptanceCriteria:
      "A white, crystalline powder; odourless; soluble in water; sparingly soluble in alcohol",
    instrumentsRequired: [] as string[],
    reagentsRequired: [] as string[],
  },
  {
    sortOrder: 2,
    testName: "Identification",
    isMandatory: true,
    resultType: ResultType.QUALITATIVE,
    acceptanceCriteria: "Positive identification by IR spectrum and chemical tests as per IP",
    instrumentsRequired: ["FTIR Spectrophotometer"],
    reagentsRequired: ["Ninhydrin reagent"],
  },
  {
    sortOrder: 3,
    testName: "pH",
    isMandatory: true,
    resultType: ResultType.QUANTITATIVE,
    minValue: "5.5",
    maxValue: "7.0",
    operator: Operator.BETWEEN,
    uom: "pH units",
    calculationFormula: "value",
    formulaVariables: {
      variables: [{ name: "value", label: "pH reading", uom: "pH units" }],
    },
    instrumentsRequired: ["pH Meter"],
    reagentsRequired: ["Purified water"],
  },
  {
    sortOrder: 4,
    testName: "Assay",
    isMandatory: true,
    resultType: ResultType.QUANTITATIVE,
    minValue: "98.5",
    operator: Operator.NLT,
    uom: "%",
    calculationFormula: "(sample_titrant_volume / std_titrant_volume) * std_concentration * 100",
    formulaVariables: {
      variables: [
        { name: "std_concentration", label: "Standard concentration", uom: "mg/ml" },
        { name: "sample_titrant_volume", label: "Sample titrant volume", uom: "ml" },
        { name: "std_titrant_volume", label: "Standard titrant volume", uom: "ml" },
      ],
    },
    instrumentsRequired: ["Analytical Balance", "Burette"],
    reagentsRequired: ["Perchloric acid", "Acetic anhydride", "Crystal violet indicator"],
  },
] as const;

async function seedGlycine(
  kavyaId: string,
  priyaId: string,
  sanjayId: string,
  qcDeptId: string,
) {
  const product = await prisma.product.upsert({
    where: { code: "GLC" },
    update: {
      name: "Glycine IP",
      chemicalName: "Glycine",
      chemicalFormula: "C2H5NO2",
      molecularWeight: new Prisma.Decimal("75.07"),
      molecularWeightUom: "g/mol",
      regulatoryRefs: ["IP"],
      originSource: "Synthetic",
      shelfLifeMonths: 24,
      storageConditions: "Store in a well-closed container at room temperature",
      status: ProductStatus.ACTIVE,
      createdById: kavyaId,
    },
    create: {
      name: "Glycine IP",
      code: "GLC",
      chemicalName: "Glycine",
      chemicalFormula: "C2H5NO2",
      molecularWeight: new Prisma.Decimal("75.07"),
      molecularWeightUom: "g/mol",
      regulatoryRefs: ["IP"],
      originSource: "Synthetic",
      shelfLifeMonths: 24,
      storageConditions: "Store in a well-closed container at room temperature",
      status: ProductStatus.ACTIVE,
      createdById: kavyaId,
    },
  });

  let master = await prisma.productMaster.findFirst({
    where: { productId: product.id, revisionNo: 1 },
  });

  if (!master) {
    master = await prisma.productMaster.create({
      data: {
        productId: product.id,
        revisionNo: 1,
        status: MasterStatus.QA_SIGNED,
        createdById: kavyaId,
        submittedById: kavyaId,
        submittedAt: new Date(),
        qcApprovedById: priyaId,
        qcApprovedAt: new Date(),
        qaSignedById: sanjayId,
        qaSignedAt: new Date(),
      },
    });
  } else {
    master = await prisma.productMaster.update({
      where: { id: master.id },
      data: {
        status: MasterStatus.QA_SIGNED,
        submittedById: kavyaId,
        submittedAt: new Date(),
        qcApprovedById: priyaId,
        qcApprovedAt: new Date(),
        qaSignedById: sanjayId,
        qaSignedAt: new Date(),
        rejectionComment: null,
        createdById: kavyaId,
      },
    });
  }

  const testParams = [];
  for (const def of GLYCINE_TESTS) {
    const existing = await prisma.testParameter.findFirst({
      where: { productMasterId: master.id, sortOrder: def.sortOrder },
    });

    const data = {
      testName: def.testName,
      isMandatory: def.isMandatory,
      resultType: def.resultType,
      acceptanceCriteria: "acceptanceCriteria" in def ? def.acceptanceCriteria : undefined,
      minValue: "minValue" in def ? new Prisma.Decimal(def.minValue) : undefined,
      maxValue: "maxValue" in def ? new Prisma.Decimal(def.maxValue) : undefined,
      operator: "operator" in def ? def.operator : undefined,
      uom: "uom" in def ? def.uom : undefined,
      departmentId: def.sortOrder >= 3 ? qcDeptId : undefined,
      calculationFormula: "calculationFormula" in def ? def.calculationFormula : undefined,
      formulaVariables: "formulaVariables" in def ? def.formulaVariables : undefined,
      instrumentsRequired: [...def.instrumentsRequired],
      reagentsRequired: [...def.reagentsRequired],
    };

    const tp = existing
      ? await prisma.testParameter.update({ where: { id: existing.id }, data })
      : await prisma.testParameter.create({
          data: { productMasterId: master.id, sortOrder: def.sortOrder, ...data },
        });
    testParams.push(tp);
  }

  const moaDefs = [
    {
      testIndex: 2,
      pharmacopoeia: "IP",
      samplePreparation:
        "Dissolve 2.0 g of the substance in 50 ml of carbon dioxide-free water and measure immediately.",
      standardPreparation: "Not applicable for pH determination.",
      blankPreparation: "Purified water as blank.",
      conclusionTemplate: "The pH of the sample solution is {{result}} pH units (Limit: 5.5 to 7.0).",
      additionalNotes: "Ensure electrode is calibrated before measurement.",
    },
    {
      testIndex: 3,
      pharmacopoeia: "IP",
      samplePreparation:
        "Weigh accurately about 0.15 g, dissolve in 50 ml of glacial acetic acid and titrate with 0.1 M perchloric acid.",
      standardPreparation:
        "Prepare 0.1 M perchloric acid in glacial acetic acid; standardize against potassium hydrogen phthalate.",
      blankPreparation: "Titrate 50 ml glacial acetic acid without sample.",
      conclusionTemplate:
        "Assay of Glycine is {{result}}% w/w (Limit: Not less than 98.5% w/w).",
      additionalNotes: "Perform triplicate determinations; RSD should not exceed 2.0%.",
    },
  ];

  for (const moa of moaDefs) {
    const testParameterId = testParams[moa.testIndex].id;
    const existingMoa = await prisma.moaSection.findFirst({
      where: { productMasterId: master.id, testParameterId },
    });
    if (!existingMoa) {
      await prisma.moaSection.create({
        data: {
          productMasterId: master.id,
          testParameterId,
          pharmacopoeia: moa.pharmacopoeia,
          samplePreparation: moa.samplePreparation,
          standardPreparation: moa.standardPreparation,
          blankPreparation: moa.blankPreparation,
          conclusionTemplate: moa.conclusionTemplate,
          additionalNotes: moa.additionalNotes,
        },
      });
    }
  }

  return { product, master, testParams };
}

async function seedGlycineSpecTemplate(
  productId: string,
  masterId: string,
  testParams: { id: string; sortOrder: number; testName: string }[],
  kavyaId: string,
  priyaId: string,
  sanjayId: string,
) {
  const signedAt = new Date();

  let template = await prisma.specTemplate.findUnique({
    where: { templateNo: SEED_GLYCINE_GENERAL_TEMPLATE_NO },
  });

  if (!template) {
    template = await prisma.specTemplate.create({
      data: {
        productId,
        sourceMasterId: masterId,
        templateNo: SEED_GLYCINE_GENERAL_TEMPLATE_NO,
        variantType: VariantType.GENERAL,
        revisionNo: 1,
        status: TemplateStatus.QA_SIGNED,
        createdById: kavyaId,
        submittedById: kavyaId,
        submittedAt: signedAt,
        qcApprovedById: priyaId,
        qcApprovedAt: signedAt,
        qaSignedById: sanjayId,
        qaSignedAt: signedAt,
      },
    });
  } else {
    template = await prisma.specTemplate.update({
      where: { id: template.id },
      data: {
        sourceMasterId: masterId,
        status: TemplateStatus.QA_SIGNED,
        submittedById: kavyaId,
        submittedAt: signedAt,
        qcApprovedById: priyaId,
        qcApprovedAt: signedAt,
        qaSignedById: sanjayId,
        qaSignedAt: signedAt,
        rejectionComment: null,
        createdById: kavyaId,
      },
    });
  }

  await prisma.specTemplateTest.deleteMany({ where: { specTemplateId: template.id } });

  for (const tp of testParams) {
    await prisma.specTemplateTest.create({
      data: {
        specTemplateId: template.id,
        testParameterId: tp.id,
        sortOrder: tp.sortOrder,
        isIncluded: tp.testName !== "Assay",
        isOptional: tp.testName === "Assay",
      },
    });
  }

  return template;
}

async function seedGlycineBatch(
  product: { id: string; code: string; shelfLifeMonths: number },
  template: { id: string; sourceMasterId: string },
  priyaId: string,
  kavyaId: string,
) {
  const existing = await prisma.batch.findUnique({
    where: { batchNo: SEED_GLYCINE_BATCH_NO },
  });

  if (existing) {
    await resetGlycineBatchDocuments(existing.id);
    return existing;
  }

  const now = new Date();
  const mfgMonth = now.getMonth() + 1;
  const mfgYear = now.getFullYear();
  const expiryDate = computeBatchExpiryDate(mfgMonth, mfgYear, product.shelfLifeMonths);

  const docFormats = {
    spec: formatBatchSpecDocNo({ productCode: product.code, batchNo: SEED_GLYCINE_BATCH_NO }),
    moa: formatBatchMoaDocNo({ productCode: product.code, batchNo: SEED_GLYCINE_BATCH_NO }),
    aws: formatBatchAwsDocNo({ productCode: product.code, batchNo: SEED_GLYCINE_BATCH_NO }),
    coa: formatBatchCoaDocNo({ productCode: product.code, batchNo: SEED_GLYCINE_BATCH_NO }),
  };

  return prisma.$transaction(async (tx) => {
    const { arn } = await generateArn(tx);

    const batch = await tx.batch.create({
      data: {
        productId: product.id,
        productMasterId: template.sourceMasterId,
        specTemplateId: template.id,
        batchNo: SEED_GLYCINE_BATCH_NO,
        arn,
        mfgDateMonth: mfgMonth,
        mfgDateYear: mfgYear,
        expiryDate,
        currentDocPhase: DocPhase.SPEC,
        status: BatchStatus.ACTIVE,
        assignedQcExecId: kavyaId,
        createdById: priyaId,
      },
    });

    await tx.batchDocument.createMany({
      data: [
        {
          batchId: batch.id,
          docType: DocType.SPEC,
          docNo: docFormats.spec,
          status: DocStatus.PENDING,
          sourceTemplateId: template.id,
          sourceMasterId: template.sourceMasterId,
          optionalTestsActivated: [],
        },
        {
          batchId: batch.id,
          docType: DocType.MOA,
          docNo: docFormats.moa,
          status: DocStatus.PENDING,
          optionalTestsActivated: [],
        },
        {
          batchId: batch.id,
          docType: DocType.AWS,
          docNo: docFormats.aws,
          status: DocStatus.PENDING,
          optionalTestsActivated: [],
        },
        {
          batchId: batch.id,
          docType: DocType.COA,
          docNo: docFormats.coa,
          status: DocStatus.PENDING,
          optionalTestsActivated: [],
        },
      ],
    });

    return batch;
  });
}

async function seedQcInstrumentsAndReagents(qcDeptId: string) {
  const pastDate = new Date("2020-01-01");
  const futureDate = new Date("2030-12-31");

  await prisma.instrument.upsert({
    where: { instrumentCode: "INST-PH-001" },
    update: {
      name: "pH Meter (Active)",
      departmentId: qcDeptId,
      useBeforeDate: futureDate,
      status: InstrumentStatus.ACTIVE,
    },
    create: {
      instrumentCode: "INST-PH-001",
      name: "pH Meter (Active)",
      departmentId: qcDeptId,
      useBeforeDate: futureDate,
      status: InstrumentStatus.ACTIVE,
    },
  });

  await prisma.instrument.upsert({
    where: { instrumentCode: "INST-PH-EXP" },
    update: {
      name: "pH Meter (Expired)",
      departmentId: qcDeptId,
      useBeforeDate: pastDate,
      status: InstrumentStatus.ACTIVE,
    },
    create: {
      instrumentCode: "INST-PH-EXP",
      name: "pH Meter (Expired)",
      departmentId: qcDeptId,
      useBeforeDate: pastDate,
      status: InstrumentStatus.ACTIVE,
    },
  });

  await prisma.reagent.deleteMany({
    where: { lotNo: { in: ["RG-ACTIVE-001", "RG-EXPIRED-001"] } },
  });

  await prisma.reagent.create({
    data: {
      name: "Perchloric acid",
      lotNo: "RG-ACTIVE-001",
      expiryDate: futureDate,
      departmentId: qcDeptId,
      status: ReagentStatus.ACTIVE,
    },
  });

  await prisma.reagent.create({
    data: {
      name: "Perchloric acid",
      lotNo: "RG-EXPIRED-001",
      expiryDate: pastDate,
      departmentId: qcDeptId,
      status: ReagentStatus.EXPIRED,
    },
  });

  console.log("  Seeded QC instruments (INST-PH-001, INST-PH-EXP) and reagent lots.");
}

// TODO: Seed Ibuprofen reference product, product master, test parameters, and MOA sections.

async function main() {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, BCRYPT_ROUNDS);

  console.log("Seeding departments...");
  const deptMap = await seedDepartments();
  console.log(`  Upserted ${DEPARTMENTS.length} departments.`);

  console.log("Seeding users...");
  await seedUsers(deptMap, passwordHash);
  console.log(`  Upserted ${USERS.length} users with bcrypt hashes.`);

  const kavya = await prisma.user.findUniqueOrThrow({ where: { username: "kavya.patel" } });
  const meera = await prisma.user.findUniqueOrThrow({ where: { username: "meera.iyer" } });
  const priya = await prisma.user.findUniqueOrThrow({ where: { username: "priya.mehta" } });
  const sanjay = await prisma.user.findUniqueOrThrow({ where: { username: "sanjay.reddy" } });
  const qcDeptId = deptMap.get(DeptName.QC)!;

  console.log("Seeding Glycine reference product and master...");
  const { product, master, testParams } = await seedGlycine(
    kavya.id,
    priya.id,
    sanjay.id,
    qcDeptId,
  );
  console.log(
    `  Product ${product.code} (${product.id}), master rev ${master.revisionNo} (${master.id}) status ${master.status}.`,
  );

  console.log("Seeding Glycine GENERAL spec template...");
  const template = await seedGlycineSpecTemplate(
    product.id,
    master.id,
    testParams,
    kavya.id,
    priya.id,
    sanjay.id,
  );
  console.log(`  Template ${template.templateNo} (${template.id}) status ${template.status}.`);

  console.log("Seeding QC instruments and reagents...");
  await seedQcInstrumentsAndReagents(qcDeptId);

  console.log("Seeding Glycine reference batch...");
  const batch = await seedGlycineBatch(product, template, priya.id, kavya.id);
  const docCount = await prisma.batchDocument.count({ where: { batchId: batch.id } });
  console.log(`  Batch ${batch.batchNo} (${batch.id}) ARN ${batch.arn}, ${docCount} documents.`);

  console.log("Advancing Glycine batch to AWS DRAFT...");
  await advanceGlycineBatchToAwsDraft(batch.id, template.id, kavya, priya, sanjay, qcDeptId);

  console.log("Advancing Glycine batch to RELEASED (Marketing demo)...");
  await advanceGlycineBatchToReleased(batch.id, kavya, meera, priya, sanjay, qcDeptId);

  console.log("Seed complete.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
