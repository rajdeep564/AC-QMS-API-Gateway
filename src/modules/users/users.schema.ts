import { DeptName, Role } from "@prisma/client";
import { z } from "zod";

export const listUsersQuerySchema = z.object({
  role: z.nativeEnum(Role).optional(),
  dept: z.nativeEnum(DeptName).optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? true : value === "true")),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
