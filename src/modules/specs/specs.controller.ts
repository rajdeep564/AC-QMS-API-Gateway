import { Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ok } from "../../lib/api-response";
import type { AuthenticatedRequest } from "../../types/authenticated-request";
import type { RejectBody, TransitionBody } from "../masters/masters.schema";
import type { CreateSpecBody, PatchSpecBody } from "./specs.schema";
import {
  approveSpec,
  createSpec,
  getSpecDetail,
  listSpecsForProduct,
  patchSpec,
  rejectSpec,
  reviseSpec,
  signSpec,
  submitSpec,
} from "./specs.service";

export const listForProduct = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id, productId } = req.params;
  const specs = await listSpecsForProduct(productId ?? id);
  res.json(ok(specs));
});

export const create = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as CreateSpecBody;
  const productId = req.params.productId ?? req.params.id;
  const spec = await createSpec(productId, body, req.user, req.ip);
  res.status(201).json(ok(spec));
});

export const getById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const spec = await getSpecDetail(id, req.user);
  res.json(ok(spec));
});

export const patch = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as PatchSpecBody;
  const { id } = req.params;
  const spec = await patchSpec(id, body, req.user, req.ip);
  res.json(ok(spec));
});

export const submit = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const spec = await submitSpec(id, req.user, req.ip);
  res.json(ok(spec));
});

export const approve = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as TransitionBody;
  const { id } = req.params;
  const spec = await approveSpec(id, body.password, req.user, req.ip);
  res.json(ok(spec));
});

export const sign = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as TransitionBody;
  const { id } = req.params;
  const spec = await signSpec(id, body.password, req.user, req.ip);
  res.json(ok(spec));
});

export const reject = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as RejectBody;
  const { id } = req.params;
  const spec = await rejectSpec(id, body.comment, req.user, req.ip);
  res.json(ok(spec));
});

export const revise = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const spec = await reviseSpec(id, req.user, req.ip);
  res.status(201).json(ok(spec));
});
