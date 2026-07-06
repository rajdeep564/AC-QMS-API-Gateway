import { Prisma } from "@prisma/client";
import { getFinancialYear, getFinancialYearStartYear } from "../utils/dates";

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
 * Atomically increments the per-FY ARN counter inside the caller's transaction.
 * Uses INSERT ... ON CONFLICT ... RETURNING — no read-then-write.
 */
export async function generateArn(
  tx: Prisma.TransactionClient,
): Promise<GenerateArnResult> {
  const financialYear = getFinancialYear();
  const rows = await tx.$queryRaw<ArnSequenceRow[]>`
    INSERT INTO arn_sequences (id, fy, seq, updated_at)
    VALUES (gen_random_uuid(), ${financialYear}, 1, now())
    ON CONFLICT (fy)
    DO UPDATE SET
      seq = arn_sequences.seq + 1,
      updated_at = now()
    RETURNING seq, fy
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("ARN sequence generation failed");
  }

  const fyStartYear = getFinancialYearStartYear();
  const sequence = row.seq;
  const arn = `AR-${fyStartYear}-${String(sequence).padStart(3, "0")}`;

  return {
    arn,
    financialYear: row.fy,
    sequence,
  };
}
