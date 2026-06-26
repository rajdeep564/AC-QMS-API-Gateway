/**
 * AWS instrument/reagent expiry checks and reagents_used JSON helpers.
 *
 * reagents_used JSON shape on aws_sections:
 * [
 *   {
 *     reagentId: string,
 *     expiredAck?: boolean,
 *     expiredAckComment?: string,
 *     expiredAckAt?: string  // ISO timestamp
 *   }
 * ]
 */
import { InstrumentStatus, ReagentStatus } from "@prisma/client";

export type ReagentUsedEntry = {
  reagentId: string;
  expiredAck?: boolean;
  expiredAckComment?: string;
  expiredAckAt?: string;
};

export function startOfUtcDay(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function parseReagentsUsed(raw: unknown): ReagentUsedEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is ReagentUsedEntry => typeof entry === "object" && entry !== null && "reagentId" in entry)
    .map((entry) => ({
      reagentId: String(entry.reagentId),
      expiredAck: entry.expiredAck,
      expiredAckComment: entry.expiredAckComment,
      expiredAckAt: entry.expiredAckAt,
    }));
}

export function clearReagentExpiredAcks(entries: ReagentUsedEntry[]): ReagentUsedEntry[] {
  return entries.map((entry) => ({
    reagentId: entry.reagentId,
    expiredAck: false,
    expiredAckComment: undefined,
    expiredAckAt: undefined,
  }));
}

export function acknowledgeReagentExpired(
  entries: ReagentUsedEntry[],
  reagentId: string,
  comment: string,
): ReagentUsedEntry[] {
  const now = new Date().toISOString();
  let found = false;
  const updated = entries.map((entry) => {
    if (entry.reagentId !== reagentId) return entry;
    found = true;
    return {
      ...entry,
      expiredAck: true,
      expiredAckComment: comment,
      expiredAckAt: now,
    };
  });
  if (!found) {
    updated.push({
      reagentId,
      expiredAck: true,
      expiredAckComment: comment,
      expiredAckAt: now,
    });
  }
  return updated;
}

type InstrumentLike = {
  useBeforeDate: Date | null;
  status: InstrumentStatus;
};

type ReagentLike = {
  expiryDate: Date;
  status: ReagentStatus;
};

export function isInstrumentExpired(instrument: InstrumentLike, today = startOfUtcDay()): boolean {
  if (instrument.status !== InstrumentStatus.ACTIVE) return true;
  if (!instrument.useBeforeDate) return false;
  const useBefore = startOfUtcDay(instrument.useBeforeDate);
  return useBefore < today;
}

export function isReagentExpired(reagent: ReagentLike, today = startOfUtcDay()): boolean {
  if (reagent.status === ReagentStatus.EXPIRED) return true;
  const expiry = startOfUtcDay(reagent.expiryDate);
  return expiry < today;
}

export function hasUnacknowledgedExpiredReagents(
  entries: ReagentUsedEntry[],
  reagentExpiryMap: Map<string, ReagentLike>,
  today = startOfUtcDay(),
): boolean {
  for (const entry of entries) {
    const reagent = reagentExpiryMap.get(entry.reagentId);
    if (!reagent) continue;
    if (isReagentExpired(reagent, today) && !entry.expiredAck) {
      return true;
    }
  }
  return false;
}
