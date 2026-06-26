import { Operator, ResultType } from "@prisma/client";
import { z } from "zod";

const testParameterSchema = z
  .object({
    sortOrder: z.number().int(),
    testName: z.string().min(1),
    isMandatory: z.boolean(),
    resultType: z.nativeEnum(ResultType),
    acceptanceCriteria: z.string().optional(),
    minValue: z.coerce.number().optional(),
    maxValue: z.coerce.number().optional(),
    operator: z.nativeEnum(Operator).optional(),
    uom: z.string().optional(),
    departmentId: z.string().uuid().optional(),
    isOutsideLab: z.boolean().optional(),
    calculationFormula: z.string().optional(),
    formulaVariables: z.record(z.unknown()).optional(),
    instrumentsRequired: z.array(z.string()).optional(),
    reagentsRequired: z.array(z.string()).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.resultType === ResultType.QUANTITATIVE) {
      if (data.operator === Operator.BETWEEN) {
        if (data.minValue === undefined || data.maxValue === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "BETWEEN operator requires both minValue and maxValue",
          });
        }
      }
      if (data.operator === Operator.NMT && data.maxValue === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "NMT operator requires maxValue",
        });
      }
      if (data.operator === Operator.NLT && data.minValue === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "NLT operator requires minValue",
        });
      }
    }
  });

const moaSectionSchema = z.object({
  testParameterIndex: z.number().int().min(0),
  pharmacopoeia: z.string().optional(),
  samplePreparation: z.string().optional(),
  standardPreparation: z.string().optional(),
  blankPreparation: z.string().optional(),
  conclusionTemplate: z.string().optional(),
  additionalNotes: z.string().optional(),
});

export const createMasterBodySchema = z.object({
  effectiveDate: z.coerce.date().optional(),
  testParameters: z.array(testParameterSchema).min(1),
  moaSections: z.array(moaSectionSchema).optional(),
});

export const transitionBodySchema = z.object({
  password: z.string().min(1),
});

export const rejectBodySchema = z.object({
  password: z.string().min(1),
  comment: z.string().min(1),
});

export type CreateMasterBody = z.infer<typeof createMasterBodySchema>;
export type TransitionBody = z.infer<typeof transitionBodySchema>;
export type RejectBody = z.infer<typeof rejectBodySchema>;
