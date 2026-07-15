import { z } from "zod";
import { MIN_EXPIRY_ACK_COMMENT_LENGTH, MIN_OOS_ACK_COMMENT_LENGTH } from "./aws.constants";

const qualitativeReadingsSchema = z
  .object({
    text: z.string().optional(),
    passFail: z.enum(["PASS", "FAIL"]).optional(),
    remarks: z.string().optional(),
    externalReportNo: z.string().optional(),
    analysisDate: z.string().optional(),
    instrumentExpiredAck: z.boolean().optional(),
    reagentExpiredAck: z.boolean().optional(),
  })
  .strict();

const quantitativeReadingsSchema = z
  .object({
    variables: z.record(z.number()).optional(),
    sets: z.array(z.record(z.number())).optional(),
    remarks: z.string().optional(),
    externalReportNo: z.string().optional(),
    analysisDate: z.string().optional(),
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
  .strict()
  .superRefine((data, ctx) => {
    if (data.comment.trim().length < MIN_EXPIRY_ACK_COMMENT_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Expiry acknowledgement comment must be at least ${MIN_EXPIRY_ACK_COMMENT_LENGTH} characters`,
        path: ["comment"],
      });
    }
  });

export const acknowledgeOosBodySchema = z
  .object({
    comment: z.string().min(1),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.comment.trim().length < MIN_OOS_ACK_COMMENT_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `OOS acknowledgement comment must be at least ${MIN_OOS_ACK_COMMENT_LENGTH} characters`,
        path: ["comment"],
      });
    }
  });

export const rejectCheckBodySchema = z
  .object({
    comment: z.string().min(1),
  })
  .strict();

export const uploadAttachmentBodySchema = z
  .object({
    fileName: z.string().min(1).max(200),
    mimeType: z.string().min(1),
    contentBase64: z.string().min(1),
  })
  .strict();

export type PatchAwsSectionBody = z.infer<typeof patchAwsSectionBodySchema>;
export type PreviewAwsSectionBody = z.infer<typeof previewAwsSectionBodySchema>;
export type AcknowledgeExpiredBody = z.infer<typeof acknowledgeExpiredBodySchema>;
export type AcknowledgeOosBody = z.infer<typeof acknowledgeOosBodySchema>;
export type RejectCheckBody = z.infer<typeof rejectCheckBodySchema>;
export type UploadAttachmentBody = z.infer<typeof uploadAttachmentBodySchema>;
