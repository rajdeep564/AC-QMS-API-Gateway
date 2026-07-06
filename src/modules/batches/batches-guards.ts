import { BatchStatus } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import * as batchesRepo from "./batches.repository";

export async function assertBatchEditable(batchId: string): Promise<void> {
  const batch = await batchesRepo.findBatchById(batchId);
  if (!batch) {
    throw AppError.notFound("Batch");
  }
  if (batch.status !== BatchStatus.DRAFT) {
    throw AppError.conflict("Batch is locked and cannot be modified");
  }
}

export async function assertBatchLocked(batchId: string): Promise<void> {
  const batch = await batchesRepo.findBatchById(batchId);
  if (!batch) {
    throw AppError.notFound("Batch");
  }
  if (batch.status === BatchStatus.APPROVED || batch.status === BatchStatus.RELEASED) {
    throw AppError.conflict("Batch is locked and cannot be modified");
  }
}
