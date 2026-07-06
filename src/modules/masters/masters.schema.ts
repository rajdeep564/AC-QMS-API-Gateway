import { FieldDataType } from "@prisma/client";
import { z } from "zod";

export const masterFieldSchema = z.object({
  fieldKey: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  value: z.string().nullable().optional(),
  dataType: z.nativeEnum(FieldDataType),
  sortOrder: z.number().int(),
  isRequired: z.boolean().optional(),
});

export const createMasterBodySchema = z
  .object({
    mode: z.enum(["direct", "assign"]),
    assignedTo: z.string().uuid().optional(),
    effectiveDate: z.coerce.date().optional(),
    fields: z.array(masterFieldSchema).min(1),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "assign" && !data.assignedTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "assignedTo is required when mode is assign",
        path: ["assignedTo"],
      });
    }
  });

export const patchFieldsBodySchema = z.object({
  fields: z.array(masterFieldSchema).min(1),
});

export const rejectBodySchema = z.object({
  comment: z.string().min(1),
});

export const assignBodySchema = z.object({
  assignedTo: z.string().uuid(),
});

export const transitionBodySchema = z.object({
  password: z.string().min(1),
});

export type CreateMasterBody = z.infer<typeof createMasterBodySchema>;
export type PatchFieldsBody = z.infer<typeof patchFieldsBodySchema>;
export type RejectBody = z.infer<typeof rejectBodySchema>;
export type AssignBody = z.infer<typeof assignBodySchema>;
export type TransitionBody = z.infer<typeof transitionBodySchema>;
