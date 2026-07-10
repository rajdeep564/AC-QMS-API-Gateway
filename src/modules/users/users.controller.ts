/**
 * User list controller — manager+ assignee picker API.
 *
 * Implements: US-24-4 (batch endpoints / assign QC_EXEC), US-9-10 (QC_MGR assigns QC_EXEC).
 */
import { Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ok } from "../../lib/api-response";
import type { AuthenticatedRequest } from "../../types/authenticated-request";
import type { ListUsersQuery } from "./users.schema";
import { listUsers } from "./users.service";

export const list = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const query = req.query as unknown as ListUsersQuery;
  const users = await listUsers(query);
  res.json(ok(users));
});
