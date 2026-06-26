import { AppError } from "../../lib/app-error";
import { parsePagination } from "../../utils/pagination";
import {
  toMarketingBatchDetail,
  toMarketingCoaDetail,
  toMarketingDocumentListItem,
} from "./marketing.mapper";
import * as marketingRepo from "./marketing.repository";
import type { ListMarketingDocumentsQuery } from "./marketing.schema";
import type {
  MarketingBatchDetailDto,
  MarketingCoaDetailDto,
  MarketingDocumentListItemDto,
} from "./marketing.types";

export async function listMarketingDocuments(query: ListMarketingDocumentsQuery): Promise<{
  items: MarketingDocumentListItemDto[];
  total: number;
  page: number;
  limit: number;
}> {
  const { page, limit, skip, take } = parsePagination(query as Record<string, unknown>);
  const { items, total } = await marketingRepo.findReleasedDocumentsForMarketing(
    {
      product: query.product,
      customer: query.customer,
      type: query.type,
      search: query.search,
    },
    { skip, take },
  );

  return {
    items: items.map(toMarketingDocumentListItem),
    total,
    page,
    limit,
  };
}

export async function getMarketingCoaById(coaId: string): Promise<MarketingCoaDetailDto> {
  const coa = await marketingRepo.findIssuedCoaById(coaId);
  if (!coa) {
    throw AppError.notFound("COA");
  }
  return toMarketingCoaDetail(coa);
}

export async function downloadMarketingCoaPdf(coaId: string): Promise<never> {
  const coa = await marketingRepo.findIssuedCoaById(coaId);
  if (!coa) {
    throw AppError.notFound("COA");
  }
  throw AppError.notImplemented("COA PDF download is pending Epic 21 SOP-on-SOP styling");
}

export async function getMarketingBatchById(batchId: string): Promise<MarketingBatchDetailDto> {
  const batch = await marketingRepo.findReleasedBatchById(batchId);
  if (!batch) {
    throw AppError.notFound("Batch");
  }
  return toMarketingBatchDetail(batch);
}

/** Epic 27 — sole Marketing write action; not implemented in Phase 1. */
export async function ackCustomerFacingCcNotification(
  _notificationId: string,
  _userId: string,
): Promise<never> {
  throw AppError.notImplemented(
    "Epic 27 Change Control — implement when change_control_notifications exist.",
  );
}
