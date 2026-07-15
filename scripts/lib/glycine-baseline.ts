import { MasterStatus, PrismaClient } from "@prisma/client";
import { GLYCINE_MASTER_FIELDS } from "../../src/fixtures/glycine-master-fields";

export const GLYCINE_PRODUCT_NAME = "Glycine";
export const GLYCINE_MASTER_FIELD_COUNT = GLYCINE_MASTER_FIELDS.length;

type DbClient = Pick<PrismaClient, "product" | "productMaster" | "productMasterField">;

/** Ensure Glycine exists with a single ACTIVE master and the canonical 18 EAV fields. */
export async function ensureGlycineMasterBaseline(
  client: DbClient,
  rajeshId: string,
): Promise<{ productId: string; masterId: string; revisionNo: number }> {
  let product = await client.product.findFirst({ where: { name: GLYCINE_PRODUCT_NAME } });
  if (!product) {
    product = await client.product.create({ data: { name: GLYCINE_PRODUCT_NAME } });
  }

  const existingMasters = await client.productMaster.findMany({
    where: { productId: product.id },
    select: { id: true },
  });

  for (const master of existingMasters) {
    await client.productMasterField.deleteMany({
      where: { productMasterId: master.id },
    });
  }
  await client.productMaster.deleteMany({ where: { productId: product.id } });

  const now = new Date();
  const created = await client.productMaster.create({
    data: {
      productId: product.id,
      revisionNo: 1,
      status: MasterStatus.ACTIVE,
      effectiveDate: now,
      createdById: rajeshId,
      approvedById: rajeshId,
      approvedAt: now,
      fields: {
        create: GLYCINE_MASTER_FIELDS.map((f) => ({
          fieldKey: f.fieldKey,
          label: f.label,
          value: f.value,
          dataType: f.dataType,
          sortOrder: f.sortOrder,
          isRequired: f.isRequired,
        })),
      },
    },
  });

  return {
    productId: product.id,
    masterId: created.id,
    revisionNo: created.revisionNo,
  };
}
