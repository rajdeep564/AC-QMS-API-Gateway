import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma-types";
import { startOfUtcDay } from "../../services/aws-expiry.service";
import type { ListReagentsQuery } from "./reagents.schema";

const reagentListSelect = {
  id: true,
  name: true,
  lotNo: true,
  expiryDate: true,
} satisfies Prisma.ReagentSelect;

export type ReagentListRow = Prisma.ReagentGetPayload<{ select: typeof reagentListSelect }>;

export async function listReagents(query: ListReagentsQuery): Promise<ReagentListRow[]> {
  const where: Prisma.ReagentWhereInput = {};

  if (query.active) {
    const today = startOfUtcDay();
    where.OR = [{ expiryDate: null }, { expiryDate: { gte: today } }];
  }

  return prisma.reagent.findMany({
    where,
    select: reagentListSelect,
    orderBy: { name: "asc" },
  });
}
