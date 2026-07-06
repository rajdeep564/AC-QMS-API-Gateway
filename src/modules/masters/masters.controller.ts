import { Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ok } from "../../lib/api-response";
import type { AuthenticatedRequest } from "../../types/authenticated-request";
import {
  approveMaster,
  assignMaster,
  createMaster,
  getMasterDetail,
  patchMasterFields,
  rejectMaster,
} from "./masters.service";
import type { AssignBody, CreateMasterBody, PatchFieldsBody, RejectBody } from "./masters.schema";

export const create = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as CreateMasterBody;
  const productId = req.params.productId ?? req.params.id;
  const master = await createMaster(productId, body, req.user, req.ip);
  res.status(201).json(ok(master));
});

export const getById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const master = await getMasterDetail(id, req.user);
  res.json(ok(master));
});

export const patchFields = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as PatchFieldsBody;
  const { id } = req.params;
  const master = await patchMasterFields(id, body, req.user, req.ip);
  res.json(ok(master));
});

export const approve = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const master = await approveMaster(id, req.user, req.ip);
  res.json(ok(master));
});

export const reject = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as RejectBody;
  const { id } = req.params;
  const master = await rejectMaster(id, body, req.user, req.ip);
  res.json(ok(master));
});

export const assign = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as AssignBody;
  const { id } = req.params;
  const master = await assignMaster(id, body, req.user, req.ip);
  res.json(ok(master));
});
