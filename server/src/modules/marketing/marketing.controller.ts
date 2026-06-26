import { Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ok, paginated } from "../../lib/api-response";
import type { AuthenticatedRequest } from "../../types/authenticated-request";
import {
  ackCustomerFacingCcNotification,
  downloadMarketingCoaPdf,
  getMarketingBatchById,
  getMarketingCoaById,
  listMarketingDocuments,
} from "./marketing.service";
import type { ListMarketingDocumentsQuery } from "./marketing.schema";

export const listDocuments = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const query = req.query as unknown as ListMarketingDocumentsQuery;
  const result = await listMarketingDocuments(query);
  res.json(paginated(result.items, result.total, result.page, result.limit));
});

export const getCoaById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const result = await getMarketingCoaById(id);
  res.json(ok(result));
});

export const downloadCoa = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  await downloadMarketingCoaPdf(id);
});

export const getBatchById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const result = await getMarketingBatchById(id);
  res.json(ok(result));
});

export const ackCcNotification = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  await ackCustomerFacingCcNotification(id, req.user.userId);
});
