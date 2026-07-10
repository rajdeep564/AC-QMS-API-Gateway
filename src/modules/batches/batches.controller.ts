import { Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ok, paginated } from "../../lib/api-response";
import type { AuthenticatedRequest } from "../../types/authenticated-request";
import { rejectBodySchema, transitionBodySchema } from "../masters/masters.schema";
import type { CreateBatchBody, ListBatchesQuery } from "./batches.schema";
import {
  approveBatch,
  createBatch as createBatchService,
  getBatchById,
  listBatches,
  rejectBatch,
  submitBatch,
} from "./batches.service";

export const list = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const query = req.query as unknown as ListBatchesQuery;
  const result = await listBatches(query);
  res.json(paginated(result.items, result.total, result.page, result.limit));
});

export const create = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as CreateBatchBody;
  const { productId } = req.params;
  const result = await createBatchService(productId, body, req.user, req.ip);
  res.status(201).json(ok(result));
});

export const getById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const batch = await getBatchById(id, req.user);
  res.json(ok(batch));
});

export const submit = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const batch = await submitBatch(id, req.user, req.ip);
  res.json(ok(batch));
});

export const approve = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = transitionBodySchema.parse(req.body);
  const { id } = req.params;
  const batch = await approveBatch(id, body.password, req.user, req.ip);
  res.json(ok(batch));
});

export const reject = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = rejectBodySchema.parse(req.body);
  const { id } = req.params;
  const batch = await rejectBatch(id, body.comment, req.user, req.ip);
  res.json(ok(batch));
});
