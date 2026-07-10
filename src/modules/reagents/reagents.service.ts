/**
 * Reagent reference list — read-only picker for AWS section execution.
 *
 * Implements: Epic 12 AWS execution UI (US-12-x).
 */
import type { ListReagentsQuery } from "./reagents.schema";
import * as reagentsRepo from "./reagents.repository";
import type { ReagentListItemDto } from "./reagents.types";

function formatDate(value: Date | null): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function toReagentListItemDto(row: reagentsRepo.ReagentListRow): ReagentListItemDto {
  return {
    id: row.id,
    name: row.name,
    lotNo: row.lotNo,
    expiryDate: formatDate(row.expiryDate),
  };
}

export async function listReagents(query: ListReagentsQuery): Promise<ReagentListItemDto[]> {
  const rows = await reagentsRepo.listReagents(query);
  return rows.map(toReagentListItemDto);
}
