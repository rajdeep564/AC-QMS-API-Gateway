import { Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ok } from "../../lib/api-response";
import type { AuthenticatedRequest } from "../../types/authenticated-request";
import type { RejectBody, SubmitDocumentBody, TransitionBody } from "../masters/masters.schema";
import {
  downloadAttachment,
  listBatchDocuments,
  listSpecDocuments,
  retryBatchDocumentRender,
  retrySpecRender,
} from "./attachments.service";
import {
  getDocumentDetail,
  listAwsApprovalQueue,
  signAndIssueCoa,
  transitionDocument,
} from "./documents.service";
import { getDocumentExplorerTree } from "./explorer.service";

export const listAwsApprovalQueueHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const queue = await listAwsApprovalQueue(req.user);
    res.json(ok(queue));
  },
);

export const getExplorerHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const productId =
      typeof req.query.productId === "string" ? req.query.productId : undefined;
    const batchId =
      typeof req.query.batchId === "string" ? req.query.batchId : undefined;
    const rawDocType =
      typeof req.query.docType === "string" ? req.query.docType.toUpperCase() : undefined;
    const docType =
      rawDocType === "SPEC" ||
      rawDocType === "MOA" ||
      rawDocType === "AWS" ||
      rawDocType === "COA"
        ? rawDocType
        : undefined;

    const tree = await getDocumentExplorerTree(req.user, {
      productId,
      batchId,
      docType,
    });
    res.json(ok(tree));
  },
);

export const getById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const document = await getDocumentDetail(id, req.user);
  res.json(ok(document));
});

export const submit = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as SubmitDocumentBody;
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
    undefined,
    req.ip,
    body.comment,
  );
  res.json(ok(updated));
});

export const downloadAttachmentHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    await downloadAttachment(id, req.user, res);
  },
);

export const listBatchDocumentsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const result = await listBatchDocuments(id, req.user);
    res.json(ok(result));
  },
);

export const listSpecDocumentsHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const result = await listSpecDocuments(id, req.user);
    res.json(ok(result));
  },
);

export const retryDocumentRenderHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { batchDocumentId } = req.params;
    const result = await retryBatchDocumentRender(batchDocumentId, req.user);
    res.json(ok(result));
  },
);

export const retrySpecRenderHandler = asyncHandler(
  async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const result = await retrySpecRender(id, req.user);
    res.json(ok(result));
  },
);
