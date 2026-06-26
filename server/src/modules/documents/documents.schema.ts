import { z } from "zod";

export const createSpecBodySchema = z.object({
  optionalTestIds: z.array(z.string().uuid()).optional(),
});

export type CreateSpecBody = z.infer<typeof createSpecBodySchema>;
