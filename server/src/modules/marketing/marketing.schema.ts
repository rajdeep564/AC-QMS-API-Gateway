import { DocType } from "@prisma/client";
import { z } from "zod";

export const listMarketingDocumentsQuerySchema = z.object({
  product: z.string().uuid().optional(),
  customer: z.string().optional(),
  type: z.nativeEnum(DocType).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const marketingIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const ackCcNotificationBodySchema = z.object({}).strict();

export type ListMarketingDocumentsQuery = z.infer<typeof listMarketingDocumentsQuerySchema>;
