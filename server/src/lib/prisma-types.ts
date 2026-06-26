import { Prisma, PrismaClient } from "@prisma/client";
import { prisma as prismaSingleton } from "../config/prisma";

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

export const prisma = prismaSingleton;
