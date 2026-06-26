import { Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ok } from "../../lib/api-response";
import type { AuthenticatedRequest } from "../../types/authenticated-request";
import type { RejectBody, TransitionBody } from "../masters/masters.schema";
import {
  getDocumentDetail,
  populateSpecDocument,
  signAndIssueCoa,
  transitionDocument,
} from "./documents.service";
import type { CreateSpecBody } from "./documents.schema";

export const createSpec = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as CreateSpecBody;
  const { batchId } = req.params;
  const result = await populateSpecDocument(batchId, body, req.user, req.ip);
  res.status(201).json(ok(result));
});

export const getById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const document = await getDocumentDetail(id, req.user);
  res.json(ok(document));
});

export const submit = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as TransitionBody;
  const { id } = req.params;
  const updated = await transitionDocument(id, "SUBMIT", req.user, body.password, req.ip);
  res.json(ok(updated));
});

export const approve = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as TransitionBody;
  const { id } = req.params;
  const updated = await transitionDocument(id, "APPROVE", req.user, body.password, req.ip);
  res.json(ok(updated));
});

export const sign = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as TransitionBody;
  const { id } = req.params;
  const updated = await transitionDocument(id, "SIGN", req.user, body.password, req.ip);
  res.json(ok(updated));
});

export const signAndIssue = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as TransitionBody;
  const { id } = req.params;
  const updated = await signAndIssueCoa(id, req.user, body.password, req.ip);
  res.json(ok(updated));
});

export const reject = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as RejectBody;
  const { id } = req.params;
  const updated = await transitionDocument(
    id,
    "REJECT",
    req.user,
    body.password,
    req.ip,
    body.comment,
  );
  res.json(ok(updated));
});
