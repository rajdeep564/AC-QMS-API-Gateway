import "dotenv/config";
import bcrypt from "bcrypt";
import { DeptName, PrismaClient, Role } from "@prisma/client";
import { ensureGlycineMasterBaseline } from "../scripts/lib/glycine-baseline";

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
  { name: DeptName.MARKETING, colorHex: "#6A1B9A", description: "Marketing" },
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
  const userMap = new Map<string, string>();

  for (const user of USERS) {
    const departmentId = user.department ? deptMap.get(user.department) ?? null : null;

    const record = await prisma.user.upsert({
      where: { username: user.username },
      update: {
        fullName: user.fullName,
        email: `${user.username}@adityachemicals.test`,
        role: user.role,
        departmentId,
        passwordHash,
        forcePwdChange: false,
        status: "ACTIVE",
        failedAttempts: 0,
        lockedUntil: null,
        deletedAt: null,
      },
      create: {
        fullName: user.fullName,
        username: user.username,
        email: `${user.username}@adityachemicals.test`,
        role: user.role,
        departmentId,
        passwordHash,
        forcePwdChange: false,
      },
    });

    userMap.set(user.username, record.id);
  }

  return userMap;
}

async function seedGlycineProduct(rajeshId: string) {
  const { productId } = await ensureGlycineMasterBaseline(prisma, rajeshId);
  return prisma.product.findUniqueOrThrow({ where: { id: productId } });
}

async function seedReferenceMasters() {
  const existingInstrument = await prisma.instrument.findFirst({
    where: { instrumentId: "HPLC-001" },
  });
  if (!existingInstrument) {
    await prisma.instrument.create({
      data: {
        instrumentId: "HPLC-001",
        name: "HPLC System",
        useBefore: new Date("2099-12-31"),
      },
    });
  }

  const existingReagent = await prisma.reagent.findFirst({
    where: { name: "Perchloric acid" },
  });
  if (!existingReagent) {
    await prisma.reagent.create({
      data: {
        name: "Perchloric acid",
        lotNo: "PCA-2026-01",
        expiryDate: new Date("2099-12-31"),
      },
    });
  }
}

async function main() {
  console.log("Seeding Session 1 baseline (Rev 2.3)...");

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, BCRYPT_ROUNDS);
  const deptMap = await seedDepartments();
  const userMap = await seedUsers(deptMap, passwordHash);

  const rajeshId = userMap.get("rajesh.kumar");
  if (!rajeshId) {
    throw new Error("Rajesh Kumar (SADMIN) not seeded");
  }

  const product = await seedGlycineProduct(rajeshId);
  await seedReferenceMasters();

  const fieldCount = await prisma.productMasterField.count({
    where: { productMaster: { productId: product.id } },
  });

  console.log(`Seeded ${USERS.length} users, product "${product.name}", master with ${fieldCount} EAV fields.`);
  console.log(`Login: rajesh.kumar / ${DEV_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
