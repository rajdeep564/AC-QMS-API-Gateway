/**
 * Instrument reference list DTO — AWS execution picker (Epic 12 / US-12-x).
 */
export type InstrumentListItemDto = {
  id: string;
  instrumentId: string;
  name: string | null;
  calibrationDate: string | null;
  /** Expiry field used by section-execution instrument check (`use_before`). */
  useBefore: string | null;
};
