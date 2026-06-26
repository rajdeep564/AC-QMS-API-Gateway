import { TemplateStatus, VariantType } from "@prisma/client";
import { z } from "zod";

const templateTestInputSchema = z.object({
  testParameterId: z.string().uuid(),
  sortOrder: z.number().int(),
  isIncluded: z.boolean().optional(),
  isOptional: z.boolean().optional(),
  overrideMinValue: z.coerce.number().optional(),
  overrideMaxValue: z.coerce.number().optional(),
  overrideAcceptance: z.string().optional(),
});

export const listSpecTemplatesQuerySchema = z.object({
  variant: z.nativeEnum(VariantType).optional(),
  status: z.nativeEnum(TemplateStatus).optional(),
  customer: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const createSpecTemplateBodySchema = z
  .object({
    sourceMasterId: z.string().uuid(),
    variantType: z.nativeEnum(VariantType),
    customerName: z.string().optional(),
    tests: z.array(templateTestInputSchema).min(1),
  })
  .superRefine((data, ctx) => {
    if (data.variantType === VariantType.CUSTOMER && !data.customerName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "customerName is required for CUSTOMER variant",
        path: ["customerName"],
      });
    }
  });

export const copySpecTemplateBodySchema = z.object({
  customerName: z.string().min(1),
});

const patchTemplateTestSchema = z.object({
  testParameterId: z.string().uuid(),
  sortOrder: z.number().int(),
  isIncluded: z.boolean().optional(),
  isOptional: z.boolean().optional(),
  overrideMinValue: z.coerce.number().optional(),
  overrideMaxValue: z.coerce.number().optional(),
  overrideAcceptance: z.string().optional(),
});

export const patchSpecTemplateBodySchema = z
  .object({
    variantType: z.nativeEnum(VariantType).optional(),
    customerName: z.string().optional(),
    tests: z.array(patchTemplateTestSchema).min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.variantType === VariantType.CUSTOMER && data.customerName !== undefined && !data.customerName.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "customerName is required for CUSTOMER variant",
        path: ["customerName"],
      });
    }
  });

export type ListSpecTemplatesQuery = z.infer<typeof listSpecTemplatesQuerySchema>;
export type CreateSpecTemplateBody = z.infer<typeof createSpecTemplateBodySchema>;
export type CopySpecTemplateBody = z.infer<typeof copySpecTemplateBodySchema>;
export type PatchSpecTemplateBody = z.infer<typeof patchSpecTemplateBodySchema>;
