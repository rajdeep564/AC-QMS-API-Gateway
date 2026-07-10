/**
 * Reagent reference list DTO — AWS execution picker (Epic 12 / US-12-x).
 */
export type ReagentListItemDto = {
  id: string;
  name: string;
  lotNo: string | null;
  /** Expiry field used by section-execution reagent check. */
  expiryDate: string | null;
};
