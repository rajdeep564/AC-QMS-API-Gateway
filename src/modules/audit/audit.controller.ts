import { Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { paginated } from "../../lib/api-response";
import type { AuthenticatedRequest } from "../../types/authenticated-request";
import type { ListAuditLogsQuery } from "./audit.schema";
import { listAuditLogs } from "./audit.service";

export const list = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const query = req.query as unknown as ListAuditLogsQuery;
  const result = await listAuditLogs(query);
  res.json(paginated(result.items, result.total, result.page, result.limit));
});
