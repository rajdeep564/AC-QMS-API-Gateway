import "dotenv/config";
import { prisma } from "../src/lib/prisma-types";

async function deleteBatchesByIds(batchIds: string[]) {
  for (const batchId of batchIds) {
    await prisma.awsSection.deleteMany({
      where: { batchDocument: { batchId } },
    });
    await prisma.coaResult.deleteMany({
      where: { batchDocument: { batchId } },
    });
    await prisma.batchDocument.deleteMany({ where: { batchId } });
    await prisma.moaDocumentSection.deleteMany({ where: { batchId } });
    await prisma.specDocumentTest.deleteMany({ where: { batchId } });
    await prisma.batch.delete({ where: { id: batchId } });
  }
}

async function deleteSpecsForProduct(productId: string) {
  await prisma.moaDocSection.deleteMany({
    where: { moaDoc: { spec: { productId } } },
  });
  await prisma.moaDoc.deleteMany({ where: { spec: { productId } } });
  await prisma.specTest.deleteMany({ where: { spec: { productId } } });
  await prisma.spec.deleteMany({ where: { productId } });
}

async function deleteProductTree(productId: string) {
  const batches = await prisma.batch.findMany({
    where: { productId },
    select: { id: true },
  });
  await deleteBatchesByIds(batches.map((b) => b.id));
  await deleteSpecsForProduct(productId);

  const masters = await prisma.productMaster.findMany({
    where: { productId },
    select: { id: true },
  });
  for (const master of masters) {
    await prisma.productMasterField.deleteMany({
      where: { productMasterId: master.id },
    });
  }
  await prisma.productMaster.deleteMany({ where: { productId } });
  await prisma.product.delete({ where: { id: productId } });
}

async function main() {
  let harnessProductsDeleted = 0;
  let orphanHarnessBatchesDeleted = 0;

  const harnessProducts = await prisma.product.findMany({
    where: {
      OR: [
        { name: { startsWith: "P2A Verify" } },
        { name: { startsWith: "P2C Verify" } },
        { name: { startsWith: "P2D Verify" } },
        { name: { startsWith: "P2D SelfIssue" } },
      ],
    },
    select: { id: true, name: true },
  });

  for (const product of harnessProducts) {
    console.log(`Deleting harness product: ${product.name}`);
    await deleteProductTree(product.id);
    harnessProductsDeleted += 1;
  }

  const orphanHarnessBatches = await prisma.batch.findMany({
    where: {
      OR: [
        { batchNo: { startsWith: "P2C/" } },
        { batchNo: { startsWith: "P2D/" } },
        { batchNo: { startsWith: "GLY-S3-" } },
      ],
    },
    select: { id: true, batchNo: true },
  });

  if (orphanHarnessBatches.length > 0) {
    console.log(
      `Deleting orphan harness batches: ${orphanHarnessBatches.map((b) => b.batchNo).join(", ")}`,
    );
    await deleteBatchesByIds(orphanHarnessBatches.map((b) => b.id));
    orphanHarnessBatchesDeleted = orphanHarnessBatches.length;
  }

  console.log("cleanup:harness complete");
  console.log(`  Harness products removed: ${harnessProductsDeleted}`);
  console.log(`  Orphan harness batches removed: ${orphanHarnessBatchesDeleted}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
