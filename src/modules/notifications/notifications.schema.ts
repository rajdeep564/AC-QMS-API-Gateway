import { z } from "zod";

export const listNotificationsQuerySchema = z.object({
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
