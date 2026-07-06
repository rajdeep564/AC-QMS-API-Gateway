import { VariantType } from "@prisma/client";
import type { Db } from "../lib/prisma-types";
import { prisma } from "../lib/prisma-types";
import { countTemplatesByProductCode } from "../modules/spec-templates/spec-templates.repository";

/**
 * Document number formatters.
 */

function variantAbbrev(variantType: VariantType): string {
  return variantType === VariantType.GENERAL ? "GEN" : "CUST";
}

/**
 * Generates a unique spec template number.
 * Format: SPEC-TPL/<productCode>/<GEN|CUST>/<seq>
 * seq is per-product, zero-padded to 3 digits.
 *
 * TODO: exact client-facing format may be refined later.
 */
export async function generateTemplateNo(
  productCode: string,
  variantType: VariantType,
  client: Db = prisma,
): Promise<string> {
  const abbrev = variantAbbrev(variantType);
  const count = await countTemplatesByProductCode(productCode, client);
  const seq = String(count + 1).padStart(3, "0");
  return `SPEC-TPL/${productCode}/${abbrev}/${seq}`;
}

export function formatBatchSpecDocNo(parts: { productCode: string; batchNo: string }): string {
  return `SPEC/${parts.productCode}/${parts.batchNo}`;
}

export function formatBatchMoaDocNo(parts: { productCode: string; batchNo: string }): string {
  return `MOA/${parts.productCode}/${parts.batchNo}`;
}

export function formatBatchAwsDocNo(parts: { productCode: string; batchNo: string }): string {
  return `AWS/${parts.productCode}/${parts.batchNo}`;
}

export function formatBatchCoaDocNo(parts: { productCode: string; batchNo: string }): string {
  return `COA/${parts.productCode}/${parts.batchNo}`;
}
