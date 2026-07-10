/**
 * AWS instrument/reagent expiry checks and readings JSON helpers (Rev 2.3).
 *
 * readings JSON may include:
 * { variables?, sets?, text?, passFail?, instrumentExpiredAck?, reagentExpiredAck? }
 */
export type AwsReadings = {
  variables?: Record<string, number>;
  sets?: Array<Record<string, number>>;
  text?: string;
  passFail?: "PASS" | "FAIL";
  instrumentExpiredAck?: boolean;
  reagentExpiredAck?: boolean;
};

export function startOfUtcDay(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function parseReadings(raw: unknown): AwsReadings {
  if (!raw || typeof raw !== "object") return {};
  return raw as AwsReadings;
}

type InstrumentLike = {
  useBefore: Date | null;
};

type ReagentLike = {
  expiryDate: Date | null;
};

export function isInstrumentExpired(instrument: InstrumentLike, today = startOfUtcDay()): boolean {
  if (!instrument.useBefore) return false;
  const useBefore = startOfUtcDay(instrument.useBefore);
  return useBefore < today;
}

export function isReagentExpired(reagent: ReagentLike, today = startOfUtcDay()): boolean {
  if (!reagent.expiryDate) return false;
  const expiry = startOfUtcDay(reagent.expiryDate);
  return expiry < today;
}

export function hasInstrumentExpiryAck(readings: unknown): boolean {
  return parseReadings(readings).instrumentExpiredAck === true;
}

export function hasReagentExpiryAck(readings: unknown): boolean {
  return parseReadings(readings).reagentExpiredAck === true;
}

export function acknowledgeInstrumentExpired(readings: unknown, comment: string): AwsReadings {
  return {
    ...parseReadings(readings),
    instrumentExpiredAck: true,
    instrumentExpiredAckComment: comment,
  } as AwsReadings & { instrumentExpiredAckComment?: string };
}

export function acknowledgeReagentExpired(readings: unknown, comment: string): AwsReadings {
  return {
    ...parseReadings(readings),
    reagentExpiredAck: true,
    reagentExpiredAckComment: comment,
  } as AwsReadings & { reagentExpiredAckComment?: string };
}

export function clearExpiryAcks(readings: unknown): AwsReadings {
  const parsed = parseReadings(readings);
  return {
    ...parsed,
    instrumentExpiredAck: false,
    reagentExpiredAck: false,
  };
}
