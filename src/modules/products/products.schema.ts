import { z } from "zod";

export const listProductsQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const createProductBodySchema = z.object({
  name: z.string().min(1).max(200),
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type CreateProductBody = z.infer<typeof createProductBodySchema>;
