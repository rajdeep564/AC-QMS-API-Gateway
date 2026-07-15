import { AppError } from "../lib/app-error";

type MasterFieldRow = { fieldKey: string; value: string | null };

/**
 * Shelf life in months from ACTIVE master EAV (expiry_month preferred, shelf_life text fallback).
 */
export function parseShelfLifeMonths(fields: MasterFieldRow[]): number {
  const expiryMonth = fields.find((f) => f.fieldKey === "expiry_month")?.value?.trim();
  if (expiryMonth) {
    const months = Number.parseInt(expiryMonth, 10);
    if (!Number.isNaN(months) && months > 0) return months;
  }

  const shelfLife = fields.find((f) => f.fieldKey === "shelf_life")?.value?.trim();
  if (shelfLife) {
    const match = shelfLife.match(/(\d+)/);
    if (match) {
      const months = Number.parseInt(match[1], 10);
      if (!Number.isNaN(months) && months > 0) return months;
    }
  }

  throw AppError.conflict("ACTIVE master is missing shelf life (expiry_month)");
}

export function getProductCode(fields: MasterFieldRow[]): string {
  const productCode = fields.find((f) => f.fieldKey === "product_code")?.value?.trim();
  if (!productCode) {
    throw AppError.conflict("ACTIVE master is missing product_code field");
  }
  return productCode;
}
