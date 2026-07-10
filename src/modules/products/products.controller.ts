import { Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ok, paginated } from "../../lib/api-response";
import type { AuthenticatedRequest } from "../../types/authenticated-request";
import type { CreateProductBody, ListProductsQuery } from "./products.schema";
import {
  createProduct,
  getProductById,
  listMastersForProduct,
  listProducts,
} from "./products.service";

export const list = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const query = req.query as unknown as ListProductsQuery;
  const result = await listProducts(query);
  res.json(paginated(result.items, result.total, result.page, result.limit));
});

export const create = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as CreateProductBody;
  const product = await createProduct(body, req.user, req.ip);
  res.status(201).json(ok(product));
});

export const getById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const product = await getProductById(id);
  res.json(ok(product));
});

export const listMasters = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const masters = await listMastersForProduct(id);
  res.json(ok(masters));
});
