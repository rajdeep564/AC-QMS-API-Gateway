import { z } from "zod";

/** Default active-only (non-expired), consistent with GET /users ?active= semantics. */
export const listReagentsQuerySchema = z.object({
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? true : value === "true")),
});

export type ListReagentsQuery = z.infer<typeof listReagentsQuerySchema>;
