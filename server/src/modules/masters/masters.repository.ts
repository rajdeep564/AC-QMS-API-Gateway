import { MasterStatus, Prisma } from "@prisma/client";
import { Db, prisma } from "../../lib/prisma-types";

export async function findProductById(id: string, client: Db = prisma) {
  return client.product.findUnique({ where: { id } });
}

export async function aggregateMasterRevision(productId: string, client: Db = prisma) {
  return client.productMaster.aggregate({
    where: { productId },
    _max: { revisionNo: true },
  });
}

export async function findMasterById(
  masterId: string,
  client: Db = prisma,
  include?: { testParameters: true; moaSections: true },
) {
  return client.productMaster.findUnique({
    where: { id: masterId },
    include,
  });
}

export async function createMaster(
  data: {
    productId: string;
    revisionNo: number;
    effectiveDate?: Date;
    createdById: string;
  },
  client: Db = prisma,
) {
  return client.productMaster.create({
    data: {
      ...data,
      status: MasterStatus.DRAFT,
    },
  });
}

export async function createTestParameter(
  data: Prisma.TestParameterCreateInput,
  client: Db = prisma,
) {
  return client.testParameter.create({ data });
}

export async function createMoaSection(
  data: Prisma.MoaSectionCreateInput,
  client: Db = prisma,
) {
  return client.moaSection.create({ data });
}

export async function findMasterWithRelations(masterId: string, client: Db = prisma) {
  return client.productMaster.findUniqueOrThrow({
    where: { id: masterId },
    include: { testParameters: true, moaSections: true },
  });
}

export async function countTestParameters(productMasterId: string, client: Db = prisma) {
  return client.testParameter.count({ where: { productMasterId } });
}

export async function findMoaSectionsByMasterId(productMasterId: string, client: Db = prisma) {
  return client.moaSection.findMany({ where: { productMasterId } });
}

export async function updateProductMaster(
  masterId: string,
  data: Prisma.ProductMasterUpdateInput,
  client: Db = prisma,
) {
  return client.productMaster.update({ where: { id: masterId }, data });
}

export async function findProductMasterById(masterId: string, client: Db = prisma) {
  return client.productMaster.findUnique({ where: { id: masterId } });
}

export async function findProductMasterWithTestParameters(masterId: string, client: Db = prisma) {
  return client.productMaster.findUnique({
    where: { id: masterId },
    include: { testParameters: true },
  });
}

export async function findProductMasterForProduct(
  masterId: string,
  productId: string,
  client: Db = prisma,
) {
  return client.productMaster.findFirst({
    where: { id: masterId, productId },
    include: { testParameters: true },
  });
}
