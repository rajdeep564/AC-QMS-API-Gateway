import { Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ok, paginated } from "../../lib/api-response";
import { transition } from "../../services/workflow-engine";
import type { AuthenticatedRequest } from "../../types/authenticated-request";
import type { RejectBody, TransitionBody } from "../masters/masters.schema";
import {
  copyTemplate as copyTemplateService,
  createFromMaster,
  getDetail,
  listForProduct,
  updateTemplate,
} from "./spec-templates.service";
import type {
  CopySpecTemplateBody,
  CreateSpecTemplateBody,
  ListSpecTemplatesQuery,
  PatchSpecTemplateBody,
} from "./spec-templates.schema";

export const list = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const query = req.query as unknown as ListSpecTemplatesQuery;
  const productId = req.params.productId ?? req.params.id;
  const result = await listForProduct(productId, query);
  res.json(paginated(result.items, result.total, result.page, result.limit));
});

export const create = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as CreateSpecTemplateBody;
  const productId = req.params.productId ?? req.params.id;
  const template = await createFromMaster(productId, body, req.user, req.ip);
  res.status(201).json(ok(template));
});

export const getById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const template = await getDetail(id, req.user);
  res.json(ok(template));
});

export const copy = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as CopySpecTemplateBody;
  const { id } = req.params;
  const template = await copyTemplateService(id, body, req.user, req.ip);
  res.status(201).json(ok(template));
});

export const patch = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as PatchSpecTemplateBody;
  const { id } = req.params;
  const template = await updateTemplate(id, body, req.user, req.ip);
  res.json(ok(template));
});

export const submit = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as TransitionBody;
  const { id } = req.params;
  const updated = await transition({
    entityType: "SPEC_TEMPLATE",
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
    entityType: "SPEC_TEMPLATE",
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
    entityType: "SPEC_TEMPLATE",
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
    entityType: "SPEC_TEMPLATE",
    entityId: id,
    action: "REJECT",
    actor: req.user,
    password: body.password,
    comment: body.comment,
    ipAddress: req.ip,
  });

  res.json(ok(updated));
});
