import { Conclusion, Operator, ResultType } from "@prisma/client";

export type QualitativeObservation = {
  text?: string;
  passFail?: "PASS" | "FAIL";
};

export type ConclusionEvaluationResult = {
  conclusion: Conclusion;
  oosDetected: boolean;
};

export type LimitContext = {
  resultType: ResultType;
  operator: Operator | null;
  minValue: number | null;
  maxValue: number | null;
};

function decimalToNumber(value: { toString(): string } | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  return Number(value.toString());
}

export function evaluateQuantitativeConclusion(
  result: number,
  limits: LimitContext,
): ConclusionEvaluationResult {
  const min = decimalToNumber(limits.minValue);
  const max = decimalToNumber(limits.maxValue);

  let satisfactory = false;

  switch (limits.operator) {
    case Operator.BETWEEN:
      satisfactory = min !== null && max !== null && result >= min && result <= max;
      break;
    case Operator.NMT:
      satisfactory = max !== null && result <= max;
      break;
    case Operator.NLT:
      satisfactory = min !== null && result >= min;
      break;
    default:
      satisfactory = false;
  }

  const conclusion = satisfactory ? Conclusion.SATISFACTORY : Conclusion.NOT_SATISFACTORY;
  return { conclusion, oosDetected: !satisfactory };
}

export function evaluateQualitativeConclusion(
  observation: QualitativeObservation,
): ConclusionEvaluationResult | null {
  if (!observation.passFail) {
    return null;
  }

  const conclusion =
    observation.passFail === "PASS" ? Conclusion.PASS : Conclusion.FAIL;
  return {
    conclusion,
    oosDetected: conclusion === Conclusion.FAIL,
  };
}

// TODO: richer text-match-to-acceptanceCriteria when needed
