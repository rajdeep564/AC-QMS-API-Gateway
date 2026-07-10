/** US-13-2 — batch AWS doc number at create (product code not in AWS path for Phase 3C). */
export function formatBatchAwsDocNo(batchNo: string): string {
  return `AWS/${batchNo}`;
}

/** US-13-2 — COA/[product short code]/[batch number] from Master product_code EAV. */
export function formatBatchCoaDocNo(parts: { productCode: string; batchNo: string }): string {
  return `COA/${parts.productCode}/${parts.batchNo}`;
}
