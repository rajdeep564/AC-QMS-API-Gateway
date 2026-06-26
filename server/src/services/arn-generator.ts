import { Prisma } from "@prisma/client";
import { getFinancialYear, getFinancialYearStartYear } from "../utils/dates";

export type GenerateArnResult = {
  arn: string;
  financialYear: string;
  sequence: number;
};

type ArnSequenceRow = {
  last_sequence: number;
  financial_year: string;
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
    INSERT INTO arn_sequences (id, financial_year, last_sequence, updated_at)
    VALUES (gen_random_uuid(), ${financialYear}, 1, now())
    ON CONFLICT (financial_year)
    DO UPDATE SET
      last_sequence = arn_sequences.last_sequence + 1,
      updated_at = now()
    RETURNING last_sequence, financial_year
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("ARN sequence generation failed");
  }

  const fyStartYear = getFinancialYearStartYear();
  const sequence = row.last_sequence;
  const arn = `AR-${fyStartYear}-${String(sequence).padStart(3, "0")}`;

  return {
    arn,
    financialYear: row.financial_year,
    sequence,
  };
}
