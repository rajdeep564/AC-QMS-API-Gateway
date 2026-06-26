import { z } from "zod";

const qualitativeObservationsSchema = z
  .object({
    text: z.string().optional(),
    passFail: z.enum(["PASS", "FAIL"]).optional(),
  })
  .strict();

const quantitativeObservationsSchema = z
  .object({
    variables: z.record(z.number()).optional(),
    sets: z.array(z.record(z.number())).optional(),
  })
  .strict();

export const observationsSchema = z.union([
  qualitativeObservationsSchema,
  quantitativeObservationsSchema,
]);

export const patchAwsSectionBodySchema = z
  .object({
    observations: observationsSchema.optional(),
    instrumentId: z.string().uuid().optional().nullable(),
    reagentsUsed: z.array(z.object({ reagentId: z.string().uuid() }).passthrough()).optional(),
    remarks: z.string().optional().nullable(),
  })
  .strict();

export const previewAwsSectionBodySchema = z
  .object({
    observations: observationsSchema,
  })
  .strict();

export const acknowledgeExpiredBodySchema = z
  .object({
    type: z.enum(["instrument", "reagent"]),
    reagentId: z.string().uuid().optional(),
    comment: z.string().min(1),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.type === "reagent" && !data.reagentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "reagentId is required when type is reagent",
        path: ["reagentId"],
      });
    }
  });

export const acknowledgeOosBodySchema = z
  .object({
    comment: z.string().optional(),
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
