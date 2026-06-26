import { ProductStatus } from "@prisma/client";
import { z } from "zod";

export const listProductsQuerySchema = z.object({
  search: z.string().optional(),
  status: z.nativeEnum(ProductStatus).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const createProductBodySchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).max(10),
  chemicalName: z.string().optional(),
  chemicalFormula: z.string().optional(),
  molecularWeight: z.coerce.number().optional(),
  molecularWeightUom: z.string().optional(),
  regulatoryRefs: z.array(z.string()).optional(),
  originSource: z.string().optional(),
  shelfLifeMonths: z.coerce.number().int().positive(),
  storageConditions: z.string().optional(),
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type CreateProductBody = z.infer<typeof createProductBodySchema>;
