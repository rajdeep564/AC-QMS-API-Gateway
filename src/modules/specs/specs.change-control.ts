import { AppError } from "../../lib/app-error";

/**
 * US-4-5 — Epic 27 Change-Control linkage seam for standing SPEC revision.
 * Session 2: no change_controls insert; optional changeControlId triggers 501 until Epic 27.
 */
export function assertRevisionChangeControlSeam(changeControlId?: string): void {
  if (!changeControlId) {
    return;
  }
  throw AppError.notImplemented(
    "Change Control linkage for SPEC revision — Epic 27",
  );
}
