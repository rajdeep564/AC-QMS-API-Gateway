import { Prisma } from "@prisma/client";

export type GenerateArnInput = {
  productId: string;
  /** Product short code from Master EAV (e.g. GCN). */
  productCode: string;
};

export type GenerateArnResult = {
  arn: string;
  financialYear: string;
  sequence: number;
};

type ArnSequenceRow = {
  seq: number;
  fy: string;
};

/**
 * Atomically increments the per-(calendar-year, product) ARN counter.
 * QA-09 format: `<YYYY> <FG> <XX>` e.g. `2026 GCN 03`.
 * Uses INSERT ... ON CONFLICT ... RETURNING — no read-then-write.
 */
export async function generateArn(
  tx: Prisma.TransactionClient,
  input: GenerateArnInput,
): Promise<GenerateArnResult> {
  const calendarYear = String(new Date().getUTCFullYear());
  const productCode = input.productCode.trim().toUpperCase();

  const rows = await tx.$queryRaw<ArnSequenceRow[]>`
    INSERT INTO arn_sequences (id, fy, product_id, seq, updated_at)
    VALUES (gen_random_uuid(), ${calendarYear}, ${input.productId}::uuid, 1, now())
    ON CONFLICT (fy, product_id)
    DO UPDATE SET
      seq = arn_sequences.seq + 1,
      updated_at = now()
    RETURNING seq, fy
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("ARN sequence generation failed");
  }

  const sequence = row.seq;
  const arn = `${calendarYear} ${productCode} ${String(sequence).padStart(2, "0")}`;

  return {
    arn,
    financialYear: row.fy,
    sequence,
  };
}
