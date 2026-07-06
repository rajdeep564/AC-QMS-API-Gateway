import { DEFAULT_LIMIT, DEFAULT_PAGE, MAX_LIMIT } from "../config/constants";

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

export function parsePagination(query: Record<string, unknown>): PaginationParams {
  const rawPage = Number(query.page ?? DEFAULT_PAGE);
  const rawLimit = Number(query.limit ?? DEFAULT_LIMIT);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : DEFAULT_PAGE;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
    : DEFAULT_LIMIT;

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    take: limit,
  };
}
