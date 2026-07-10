/**
 * Instrument reference list — read-only picker for AWS section execution.
 *
 * Implements: Epic 12 AWS execution UI (US-12-x).
 */
import type { ListInstrumentsQuery } from "./instruments.schema";
import * as instrumentsRepo from "./instruments.repository";
import type { InstrumentListItemDto } from "./instruments.types";

function formatDate(value: Date | null): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function toInstrumentListItemDto(row: instrumentsRepo.InstrumentListRow): InstrumentListItemDto {
  return {
    id: row.id,
    instrumentId: row.instrumentId,
    name: row.name,
    calibrationDate: formatDate(row.calibrationDate),
    useBefore: formatDate(row.useBefore),
  };
}

export async function listInstruments(query: ListInstrumentsQuery): Promise<InstrumentListItemDto[]> {
  const rows = await instrumentsRepo.listInstruments(query);
  return rows.map(toInstrumentListItemDto);
}
