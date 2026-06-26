import { Prisma, Product } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { parsePagination } from "../../utils/pagination";
import { CreateProductBody, ListProductsQuery } from "./products.schema";
import { ProductDto, ProductMasterSummaryDto } from "./products.types";
import * as productsRepo from "./products.repository";

function toProductDto(product: Product): ProductDto {
  return {
    id: product.id,
    name: product.name,
    code: product.code,
    chemicalName: product.chemicalName,
    chemicalFormula: product.chemicalFormula,
    molecularWeight: product.molecularWeight?.toString() ?? null,
    molecularWeightUom: product.molecularWeightUom,
    regulatoryRefs: product.regulatoryRefs,
    originSource: product.originSource,
    shelfLifeMonths: product.shelfLifeMonths,
    storageConditions: product.storageConditions,
    status: product.status,
    createdById: product.createdById,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export async function listProducts(query: ListProductsQuery) {
  const { page, limit, skip, take } = parsePagination(query as Record<string, unknown>);

  const where: Prisma.ProductWhereInput = {};

  if (query.status) {
    where.status = query.status;
  }

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { code: { contains: query.search, mode: "insensitive" } },
      { chemicalName: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    productsRepo.findManyProducts(where, skip, take),
    productsRepo.countProducts(where),
  ]);

  return {
    items: items.map(toProductDto),
    total,
    page,
    limit,
  };
}

export async function createProduct(body: CreateProductBody, createdById: string): Promise<ProductDto> {
  const product = await productsRepo.createProduct({
    name: body.name,
    code: body.code,
    chemicalName: body.chemicalName,
    chemicalFormula: body.chemicalFormula,
    molecularWeight: body.molecularWeight,
    molecularWeightUom: body.molecularWeightUom,
    regulatoryRefs: body.regulatoryRefs ?? [],
    originSource: body.originSource,
    shelfLifeMonths: body.shelfLifeMonths,
    storageConditions: body.storageConditions,
    createdById,
  });

  return toProductDto(product);
}

export async function getProductById(id: string): Promise<ProductDto> {
  const product = await productsRepo.findProductById(id);
  if (!product) {
    throw AppError.notFound("Product");
  }
  return toProductDto(product);
}

export async function listMastersForProduct(productId: string): Promise<ProductMasterSummaryDto[]> {
  const product = await productsRepo.findProductById(productId);
  if (!product) {
    throw AppError.notFound("Product");
  }

  const masters = await productsRepo.findMastersByProductId(productId);

  return masters.map((m) => ({
    id: m.id,
    revisionNo: m.revisionNo,
    status: m.status,
    effectiveDate: m.effectiveDate,
    createdById: m.createdById,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }));
}
