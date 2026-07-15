import { addMonths as dateFnsAddMonths, endOfMonth, subMonths } from "date-fns";

/**
 * Add months to a date (calendar-aware via date-fns).
 */
export function addMonths(date: Date, months: number): Date {
  return dateFnsAddMonths(date, months);
}

/**
 * Compute expiry date from a manufacturing date and shelf life in months.
 */
export function computeExpiryDate(mfgDate: Date, shelfLifeMonths: number): Date {
  return addMonths(mfgDate, shelfLifeMonths);
}

/**
 * Indian financial year label (Apr–Mar), e.g. "2026-2027".
 */
export function getFinancialYear(date: Date = new Date()): string {
  const startYear = getFinancialYearStartYear(date);
  return `${startYear}-${startYear + 1}`;
}

/**
 * Start calendar year of the Indian financial year containing the given date.
 */
export function getFinancialYearStartYear(date: Date = new Date()): number {
  const month = date.getMonth(); // 0-indexed; April = 3
  const year = date.getFullYear();
  return month >= 3 ? year : year - 1;
}

/**
 * Manufacturing anchor: last calendar day of the given month/year (UTC).
 * @param mfgMonth 1-indexed month (1 = January).
 */
export function mfgMonthToDate(mfgMonth: number, mfgYear: number): Date {
  return new Date(Date.UTC(mfgYear, mfgMonth, 0));
}

/**
 * Batch expiry (US-9-8): last day of the month before (mfg month + shelf life months).
 * E.g. Mfg March 2026 + 60 months → February 2031.
 */
export function computeBatchExpiryDate(
  mfgMonth: number,
  mfgYear: number,
  shelfLifeMonths: number,
): Date {
  const mfgAnchor = mfgMonthToDate(mfgMonth, mfgYear);
  const expiryAnchor = addMonths(mfgAnchor, shelfLifeMonths);
  return endOfMonth(subMonths(expiryAnchor, 1));
}

/** Derive batch expiry from an ISO mfg date (first of month) and shelf life in months. */
export function expDateFromMfgDate(mfgDate: Date, shelfLifeMonths: number): Date {
  const mfgMonth = mfgDate.getUTCMonth() + 1;
  const mfgYear = mfgDate.getUTCFullYear();
  return computeBatchExpiryDate(mfgMonth, mfgYear, shelfLifeMonths);
}
