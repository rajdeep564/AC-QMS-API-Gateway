import { BatchStatus } from "@prisma/client";
import { Db, prisma } from "../../lib/prisma-types";
import { AppError } from "../../lib/app-error";
import * as batchesRepo from "./batches.repository";

/** US-9-13 / Dev Bible §5.3: batch core fields editable only while DRAFT. */
export async function assertBatchEditable(batchId: string, client: Db = prisma): Promise<void> {
  const batch = await batchesRepo.findBatchById(batchId, client);
  if (!batch) {
    throw AppError.notFound("Batch");
  }
  if (batch.status !== BatchStatus.DRAFT) {
    throw AppError.conflict("Batch is locked and cannot be modified");
  }
}

/** Throws when batch is APPROVED/RELEASED — use before any snapshot or core-field mutation. */
export async function assertBatchLocked(batchId: string, client: Db = prisma): Promise<void> {
  const batch = await batchesRepo.findBatchById(batchId, client);
  if (!batch) {
    throw AppError.notFound("Batch");
  }
  if (batch.status === BatchStatus.APPROVED || batch.status === BatchStatus.RELEASED) {
    throw AppError.conflict("Batch is locked and cannot be modified");
  }
}

/** Allows workflow transitions; blocks post-approval mutation except APPROVED→RELEASED. */
export async function assertBatchStatusMutationAllowed(
  batchId: string,
  toStatus: BatchStatus,
  client: Db = prisma,
): Promise<void> {
  const batch = await batchesRepo.findBatchById(batchId, client);
  if (!batch) {
    throw AppError.notFound("Batch");
  }
  if (batch.status === BatchStatus.APPROVED || batch.status === BatchStatus.RELEASED) {
    const releaseOnly =
      batch.status === BatchStatus.APPROVED && toStatus === BatchStatus.RELEASED;
    if (!releaseOnly) {
      throw AppError.conflict("Batch is locked and cannot be modified");
    }
  }
}
