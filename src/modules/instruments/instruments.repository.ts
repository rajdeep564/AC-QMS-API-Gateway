import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma-types";
import { startOfUtcDay } from "../../services/aws-expiry.service";
import type { ListInstrumentsQuery } from "./instruments.schema";

const instrumentListSelect = {
  id: true,
  instrumentId: true,
  name: true,
  calibrationDate: true,
  useBefore: true,
} satisfies Prisma.InstrumentSelect;

export type InstrumentListRow = Prisma.InstrumentGetPayload<{
  select: typeof instrumentListSelect;
}>;

export async function listInstruments(query: ListInstrumentsQuery): Promise<InstrumentListRow[]> {
  const where: Prisma.InstrumentWhereInput = {};

  if (query.active) {
    const today = startOfUtcDay();
    where.OR = [{ useBefore: null }, { useBefore: { gte: today } }];
  }

  return prisma.instrument.findMany({
    where,
    select: instrumentListSelect,
    orderBy: { instrumentId: "asc" },
  });
}
