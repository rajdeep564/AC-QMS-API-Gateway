import { Prisma } from "@prisma/client";
import { Db, prisma } from "../../lib/prisma-types";

export async function findManyProducts(
  where: Prisma.ProductWhereInput,
  skip: number,
  take: number,
  client: Db = prisma,
) {
  return client.product.findMany({
    where,
    skip,
    take,
    orderBy: { name: "asc" },
  });
}

export async function countProducts(where: Prisma.ProductWhereInput, client: Db = prisma) {
  return client.product.count({ where });
}

export async function createProduct(data: { name: string }, client: Db = prisma) {
  return client.product.create({ data });
}

export async function findProductById(id: string, client: Db = prisma) {
  return client.product.findUnique({ where: { id } });
}

export async function findMastersByProductId(productId: string, client: Db = prisma) {
  return client.productMaster.findMany({
    where: { productId },
    orderBy: { revisionNo: "desc" },
  });
}
