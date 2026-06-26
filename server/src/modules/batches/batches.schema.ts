import { BatchStatus } from "@prisma/client";
import { z } from "zod";

export const listBatchesQuerySchema = z.object({
  status: z.nativeEnum(BatchStatus).optional(),
  product: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const createBatchBodySchema = z.object({
  productId: z.string().uuid(),
  specTemplateId: z.string().uuid(),
  batchNo: z.string().min(1),
  mfgMonth: z.number().int().min(1).max(12),
  mfgYear: z.number().int().min(2000).max(2100),
  batchSize: z.coerce.number().positive().optional(),
  batchSizeUom: z.string().optional(),
  qtySampled: z.coerce.number().positive().optional(),
  qtySampledUom: z.string().optional(),
  assignedQcExecId: z.string().uuid(),
  customerName: z.string().optional(),
  customerRef: z.string().optional(),
  customerSpecialInstructions: z.string().optional(),
});

export type ListBatchesQuery = z.infer<typeof listBatchesQuerySchema>;
export type CreateBatchBody = z.infer<typeof createBatchBodySchema>;
