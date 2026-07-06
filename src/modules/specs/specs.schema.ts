import { Operator, ResultType, SpecVariant } from "@prisma/client";
import { z } from "zod";

export const specTestSchema = z.object({
  sortOrder: z.number().int(),
  testName: z.string().min(1).max(200),
  resultType: z.nativeEnum(ResultType),
  operator: z.nativeEnum(Operator).nullable().optional(),
  minValue: z.union([z.number(), z.string()]).nullable().optional(),
  maxValue: z.union([z.number(), z.string()]).nullable().optional(),
  uom: z.string().max(40).nullable().optional(),
  acceptanceCriteria: z.string().nullable().optional(),
  formula: z.string().nullable().optional(),
  formulaVariables: z.unknown().nullable().optional(),
  isOptional: z.boolean().optional(),
  isOutsideLab: z.boolean().optional(),
});

export const moaSectionSchema = z.object({
  specTestRef: z.number().int().nonnegative(),
  pharmacopoeia: z.string().max(50).nullable().optional(),
  samplePreparation: z.string().nullable().optional(),
  standardPreparation: z.string().nullable().optional(),
  blankPreparation: z.string().nullable().optional(),
  conclusionTemplate: z.string().nullable().optional(),
  additionalNotes: z.string().nullable().optional(),
});

const specContentSchema = z.object({
  tests: z.array(specTestSchema).min(1),
  moaSections: z.array(moaSectionSchema).min(1),
});

function validateMoaSectionRefs(
  tests: { length: number },
  moaSections: { specTestRef: number }[],
  ctx: z.RefinementCtx,
) {
  for (const section of moaSections) {
    if (section.specTestRef < 0 || section.specTestRef >= tests.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `specTestRef ${section.specTestRef} is out of range for tests array`,
        path: ["moaSections"],
      });
    }
  }
}

export const createSpecBodySchema = z
  .object({
    variant: z.literal(SpecVariant.GENERAL),
    specNo: z.string().max(80).optional(),
    effectiveDate: z.coerce.date().optional(),
    tests: z.array(specTestSchema).min(1),
    moaSections: z.array(moaSectionSchema).min(1),
  })
  .superRefine((data, ctx) => validateMoaSectionRefs(data.tests, data.moaSections, ctx));

export const patchSpecBodySchema = z
  .object({
    effectiveDate: z.coerce.date().optional(),
    tests: z.array(specTestSchema).min(1),
    moaSections: z.array(moaSectionSchema).min(1),
  })
  .superRefine((data, ctx) => validateMoaSectionRefs(data.tests, data.moaSections, ctx));

export type CreateSpecBody = z.infer<typeof createSpecBodySchema>;
export type PatchSpecBody = z.infer<typeof patchSpecBodySchema>;
