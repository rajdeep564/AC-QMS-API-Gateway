import { Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ok } from "../../lib/api-response";
import { transition } from "../../services/workflow-engine";
import type { AuthenticatedRequest } from "../../types/authenticated-request";
import { getMasterDetail, createMaster as createMasterService } from "./masters.service";
import type { CreateMasterBody, RejectBody, TransitionBody } from "./masters.schema";

export const create = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as CreateMasterBody;
  const productId = req.params.productId ?? req.params.id;
  const master = await createMasterService(productId, body, req.user, req.ip);
  res.status(201).json(ok(master));
});

export const getById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const master = await getMasterDetail(id, req.user);
  res.json(ok(master));
});

export const submit = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as TransitionBody;
  const { id } = req.params;
  const updated = await transition({
    entityType: "PRODUCT_MASTER",
    entityId: id,
    action: "SUBMIT",
    actor: req.user,
    password: body.password,
    ipAddress: req.ip,
  });

  res.json(ok(updated));
});

export const approve = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as TransitionBody;
  const { id } = req.params;
  const updated = await transition({
    entityType: "PRODUCT_MASTER",
    entityId: id,
    action: "APPROVE",
    actor: req.user,
    password: body.password,
    ipAddress: req.ip,
  });

  res.json(ok(updated));
});

export const sign = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as TransitionBody;
  const { id } = req.params;
  const updated = await transition({
    entityType: "PRODUCT_MASTER",
    entityId: id,
    action: "SIGN",
    actor: req.user,
    password: body.password,
    ipAddress: req.ip,
  });

  res.json(ok(updated));
});

export const reject = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as RejectBody;
  const { id } = req.params;
  const updated = await transition({
    entityType: "PRODUCT_MASTER",
    entityId: id,
    action: "REJECT",
    actor: req.user,
    password: body.password,
    comment: body.comment,
    ipAddress: req.ip,
  });

  res.json(ok(updated));
});
