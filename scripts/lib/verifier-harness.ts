/**
 * Isolated product for API verification harnesses — never touches demo Glycine standing SPECs.
 */
import { MasterStatus, Role } from "@prisma/client";
import { prisma } from "../../src/lib/prisma-types";
import { JwtAccessPayload } from "../../src/types/auth.types";
import {
  approveSpec,
  createSpec,
  findBatchReadySpec,
  signSpec,
  submitSpec,
} from "../../src/modules/specs/specs.service";
import { drainDocumentRenderQueues } from "../../src/services/render-documents.service";
import {
  EXPECTED_TEST_COUNT,
  SAMPLE_SPEC_BODY,
} from "../fixtures/spec-sample-body";
import type { CreateSpecBody } from "../../src/modules/specs/specs.schema";

export const VERIFIER_PRODUCT_NAME = "Verifier Harness Product";

const DEV_PASSWORD = "Acqms@2026";

export async function ensureVerifierProduct() {
  let product = await prisma.product.findFirst({ where: { name: VERIFIER_PRODUCT_NAME } });
  if (!product) {
    product = await prisma.product.create({ data: { name: VERIFIER_PRODUCT_NAME } });
  }
  return product;
}

/** Minimal ACTIVE master so standing SPEC create passes US-4 gate. */
export async function ensureVerifierActiveMaster(adminUserId: string) {
  const product = await ensureVerifierProduct();
  const existing = await prisma.productMaster.findFirst({
    where: { productId: product.id, status: MasterStatus.ACTIVE },
  });
  if (existing) {
    // Ensure shelf-life + product_code for batch create
    const fields = await prisma.productMasterField.findMany({
      where: { productMasterId: existing.id },
    });
    if (!fields.some((f) => f.fieldKey === "expiry_month")) {
      await prisma.productMasterField.create({
        data: {
          productMasterId: existing.id,
          fieldKey: "expiry_month",
          label: "Expiry (months)",
          value: "36",
          dataType: "NUMBER",
          sortOrder: 2,
          isRequired: true,
        },
      });
    }
    return existing;
  }

  const now = new Date();
  return prisma.productMaster.create({
    data: {
      productId: product.id,
      revisionNo: 1,
      status: MasterStatus.ACTIVE,
      effectiveDate: now,
      createdById: adminUserId,
      approvedById: adminUserId,
      approvedAt: now,
      fields: {
        create: [
          {
            fieldKey: "product_code",
            label: "Product Code",
            value: "VFY",
            dataType: "TEXT",
            sortOrder: 1,
            isRequired: true,
          },
          {
            fieldKey: "expiry_month",
            label: "Expiry (months)",
            value: "36",
            dataType: "NUMBER",
            sortOrder: 2,
            isRequired: true,
          },
        ],
      },
    },
  });
}

/**
 * Await in-flight post-commit renders before deleting fixtures (prevents target-gone races).
 */
export async function drainBeforeCleanup(timeoutMs = 60_000): Promise<void> {
  await drainDocumentRenderQueues(timeoutMs);
}

export async function cleanupVerifierHarnessData(productId: string) {
  await drainBeforeCleanup();
  const batches = await prisma.batch.findMany({ where: { productId }, select: { id: true } });
  for (const batch of batches) {
    await prisma.awsSection.deleteMany({
      where: { batchDocument: { batchId: batch.id } },
    });
    await prisma.coaResult.deleteMany({
      where: { batchDocument: { batchId: batch.id } },
    });
    await prisma.batchDocument.deleteMany({ where: { batchId: batch.id } });
    await prisma.moaDocumentSection.deleteMany({ where: { batchId: batch.id } });
    await prisma.specDocumentTest.deleteMany({ where: { batchId: batch.id } });
    await prisma.batch.delete({ where: { id: batch.id } });
  }
}

export async function resetVerifierStandingSpecs(productId: string) {
  await prisma.moaDocSection.deleteMany({
    where: { moaDoc: { spec: { productId } } },
  });
  await prisma.moaDoc.deleteMany({ where: { spec: { productId } } });
  await prisma.specTest.deleteMany({ where: { spec: { productId } } });
  await prisma.spec.deleteMany({ where: { productId } });
}

export async function ensureQaSignedHarnessSpec(
  productId: string,
  kavyaId: string,
  priyaId: string,
  sanjayId: string,
  specBody: CreateSpecBody = SAMPLE_SPEC_BODY,
) {
  await cleanupVerifierHarnessData(productId);
  await resetVerifierStandingSpecs(productId);

  const actor = (userId: string, role: Role): JwtAccessPayload => ({ userId, role, departmentId: null });

  const created = await createSpec(productId, specBody, actor(kavyaId, Role.QC_EXEC));
  await submitSpec(created.id, actor(kavyaId, Role.QC_EXEC));
  await approveSpec(created.id, DEV_PASSWORD, actor(priyaId, Role.QC_MGR));
  await signSpec(created.id, DEV_PASSWORD, actor(sanjayId, Role.QA_MGR));
  const signed = await findBatchReadySpec(productId);
  if (!signed) throw new Error("Failed to obtain QA_SIGNED harness spec");
  return signed;
}

export { EXPECTED_TEST_COUNT, SAMPLE_SPEC_BODY, DEV_PASSWORD };
