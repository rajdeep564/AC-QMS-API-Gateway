/**
 * Instrument reference list controller — AWS execution picker.
 *
 * Implements: Epic 12 AWS execution UI (US-12-x).
 */
import { Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ok } from "../../lib/api-response";
import type { AuthenticatedRequest } from "../../types/authenticated-request";
import type { ListInstrumentsQuery } from "./instruments.schema";
import { listInstruments } from "./instruments.service";

export const list = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const query = req.query as unknown as ListInstrumentsQuery;
  const instruments = await listInstruments(query);
  res.json(ok(instruments));
});
