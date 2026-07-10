import { Prisma, Product } from "@prisma/client";
import { prisma } from "../../lib/prisma-types";
import { AppError } from "../../lib/app-error";
import { AuditAction, AuditEntityType, log as auditLog } from "../../services/audit.service";
import { parsePagination } from "../../utils/pagination";
import { getUserById } from "../auth/auth.service";
import { CreateProductBody, ListProductsQuery } from "./products.schema";
import { ProductDto, ProductMasterSummaryDto } from "./products.types";
import * as productsRepo from "./products.repository";

function toProductDto(product: Product): ProductDto {
  return {
    id: product.id,
    name: product.name,
    createdAt: product.createdAt,
  };
}

export async function listProducts(query: ListProductsQuery) {
  const { page, limit, skip, take } = parsePagination(query as Record<string, unknown>);

  const where: Prisma.ProductWhereInput = {};

  if (query.search) {
    where.name = { contains: query.search, mode: "insensitive" };
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

export async function createProduct(
  body: CreateProductBody,
  actor: { userId: string; role: string },
  ipAddress?: string,
): Promise<ProductDto> {
  const actorUser = await getUserById(actor.userId);

  const product = await prisma.$transaction(async (tx) => {
    const created = await productsRepo.createProduct({ name: body.name }, tx);
    await auditLog(
      {
        userId: actor.userId,
        userName: actorUser?.fullName,
        role: actor.role,
        department: actorUser?.department?.name,
        action: AuditAction.CREATE,
        entityType: AuditEntityType.PRODUCT,
        entityId: created.id,
        ipAddress,
      },
      tx,
    );
    return created;
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
    assignedToId: m.assignedToId,
    approvedById: m.approvedById,
    approvedAt: m.approvedAt,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }));
}
