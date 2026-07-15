import { computeBatchExpiryDate, expDateFromMfgDate } from "../src/utils/dates";

function assertSameDay(actual: Date, expectedYear: number, expectedMonth: number, expectedDay: number): void {
  if (
    actual.getUTCFullYear() !== expectedYear ||
    actual.getUTCMonth() + 1 !== expectedMonth ||
    actual.getUTCDate() !== expectedDay
  ) {
    throw new Error(
      `Expected ${expectedYear}-${String(expectedMonth).padStart(2, "0")}-${String(expectedDay).padStart(2, "0")}, got ${actual.toISOString()}`,
    );
  }
}

function runTest(name: string, fn: () => void): void {
  fn();
  console.log(`  PASS: ${name}`);
}

console.log("Batch expiry date self-tests (US-9-8)\n");

runTest("60-month shelf life: Mfg March 2026 → February 2031", () => {
  const exp = computeBatchExpiryDate(3, 2026, 60);
  assertSameDay(exp, 2031, 2, 28);
});

runTest("24-month shelf life: Mfg May 2026 → April 2028", () => {
  const exp = computeBatchExpiryDate(5, 2026, 24);
  assertSameDay(exp, 2028, 4, 30);
});

runTest("expDateFromMfgDate via ISO mfg anchor (March 2026)", () => {
  const mfg = new Date("2026-03-01T00:00:00.000Z");
  const exp = expDateFromMfgDate(mfg, 60);
  assertSameDay(exp, 2031, 2, 28);
});

runTest("expDateFromMfgDate via ISO mfg anchor (May 2026)", () => {
  const mfg = new Date("2026-05-01T00:00:00.000Z");
  const exp = expDateFromMfgDate(mfg, 24);
  assertSameDay(exp, 2028, 4, 30);
});

console.log("\nAll batch expiry tests passed.");
