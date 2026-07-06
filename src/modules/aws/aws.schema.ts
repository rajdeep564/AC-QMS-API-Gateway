import { z } from "zod";

const qualitativeReadingsSchema = z
  .object({
    text: z.string().optional(),
    passFail: z.enum(["PASS", "FAIL"]).optional(),
    oosAckComment: z.string().optional(),
    instrumentExpiredAck: z.boolean().optional(),
    reagentExpiredAck: z.boolean().optional(),
  })
  .strict();

const quantitativeReadingsSchema = z
  .object({
    variables: z.record(z.number()).optional(),
    sets: z.array(z.record(z.number())).optional(),
    oosAckComment: z.string().optional(),
    instrumentExpiredAck: z.boolean().optional(),
    reagentExpiredAck: z.boolean().optional(),
  })
  .strict();

export const readingsSchema = z.union([qualitativeReadingsSchema, quantitativeReadingsSchema]);

export const patchAwsSectionBodySchema = z
  .object({
    readings: readingsSchema.optional(),
    instrumentId: z.string().uuid().optional().nullable(),
    reagentId: z.string().uuid().optional().nullable(),
  })
  .strict();

export const previewAwsSectionBodySchema = z
  .object({
    readings: readingsSchema,
  })
  .strict();

export const acknowledgeExpiredBodySchema = z
  .object({
    type: z.enum(["instrument", "reagent"]),
    comment: z.string().min(1),
  })
  .strict();

export const acknowledgeOosBodySchema = z
  .object({
    comment: z.string().min(1),
  })
  .strict();

export const rejectCheckBodySchema = z
  .object({
    comment: z.string().min(1),
  })
  .strict();

export type PatchAwsSectionBody = z.infer<typeof patchAwsSectionBodySchema>;
export type PreviewAwsSectionBody = z.infer<typeof previewAwsSectionBodySchema>;
export type AcknowledgeExpiredBody = z.infer<typeof acknowledgeExpiredBodySchema>;
export type AcknowledgeOosBody = z.infer<typeof acknowledgeOosBodySchema>;
export type RejectCheckBody = z.infer<typeof rejectCheckBodySchema>;
