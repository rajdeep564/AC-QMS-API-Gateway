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
  sourceSpecId: z.string().uuid(),
  batchNo: z.string().min(1),
  mfgDate: z.coerce.date().optional(),
  expDate: z.coerce.date().optional(),
  batchSize: z.string().optional(),
  assignedQcExecId: z.string().uuid(),
});

export type ListBatchesQuery = z.infer<typeof listBatchesQuerySchema>;
export type CreateBatchBody = z.infer<typeof createBatchBodySchema>;
