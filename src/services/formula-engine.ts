/**
 * Safe formula evaluation for AWS quantitative tests.
 *
 * Canonical formulaVariables JSON shape (test_parameters.formula_variables):
 * {
 *   variables: [{ name: string, label?: string, uom?: string }],
 *   steps?: [{ name: string, formula: string }]  // multi-step; each name feeds later steps
 * }
 *
 * Legacy shape (object map) is normalized at runtime:
 * { std_concentration: { label, uom }, ... } → variables array
 *
 * Replicate observations: when observations.sets is provided, each input variable
 * is the arithmetic mean of that variable across all sets before evaluation.
 */
import { create, all } from "mathjs";
import { AppError } from "../lib/app-error";

const math = create(all, {});

const MATH_CONSTANTS = new Set(["pi", "e", "true", "false", "Infinity", "NaN"]);
const MATH_FUNCTIONS = new Set([
  "abs",
  "sqrt",
  "round",
  "floor",
  "ceil",
  "min",
  "max",
  "pow",
  "log",
  "log10",
  "exp",
  "sin",
  "cos",
  "tan",
]);

/** Default display precision — TODO: per-test precision when schema supports it */
const DEFAULT_DISPLAY_PRECISION = 2;

export type FormulaVariableDef = {
  name: string;
  label?: string;
  uom?: string;
};

export type FormulaStepDef = {
  name: string;
  formula: string;
};

export type FormulaVariablesConfig = {
  variables: FormulaVariableDef[];
  steps?: FormulaStepDef[];
};

export type QuantitativeObservations = {
  variables?: Record<string, number>;
  sets?: Array<Record<string, number>>;
};

export type FormulaEvaluationResult = {
  result: number;
  resultDisplay: string;
};

export function normalizeFormulaVariables(raw: unknown): FormulaVariablesConfig {
  if (!raw || typeof raw !== "object") {
    return { variables: [] };
  }

  const obj = raw as Record<string, unknown>;

  if (Array.isArray(obj.variables)) {
    return {
      variables: obj.variables
        .filter((v): v is FormulaVariableDef => typeof v === "object" && v !== null && "name" in v)
        .map((v) => ({
          name: String((v as FormulaVariableDef).name),
          label: (v as FormulaVariableDef).label,
          uom: (v as FormulaVariableDef).uom,
        })),
      steps: Array.isArray(obj.steps)
        ? obj.steps
            .filter((s): s is FormulaStepDef => typeof s === "object" && s !== null && "name" in s && "formula" in s)
            .map((s) => ({ name: String(s.name), formula: String(s.formula) }))
        : undefined,
    };
  }

  // Legacy object map: { varName: { label, uom } }
  const variables: FormulaVariableDef[] = [];
  for (const [name, meta] of Object.entries(obj)) {
    if (name === "steps") continue;
    const m = meta as { label?: string; uom?: string } | null;
    variables.push({
      name,
      label: m?.label,
      uom: m?.uom,
    });
  }
  return { variables };
}

export function getRequiredVariableNames(config: FormulaVariablesConfig): string[] {
  return config.variables.map((v) => v.name);
}

/**
 * Build variable map from quantitative observations.
 * When sets are provided, each variable is the arithmetic mean across sets.
 * Explicit variables override computed means.
 */
export function buildVariableMapFromObservations(
  requiredNames: string[],
  observations: QuantitativeObservations,
): Record<string, number> {
  const result: Record<string, number> = {};

  if (observations.sets && observations.sets.length > 0) {
    for (const name of requiredNames) {
      const values = observations.sets
        .map((set) => set[name])
        .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
      if (values.length > 0) {
        result[name] = values.reduce((sum, v) => sum + v, 0) / values.length;
      }
    }
  }

  if (observations.variables) {
    for (const [name, value] of Object.entries(observations.variables)) {
      if (typeof value === "number" && !Number.isNaN(value)) {
        result[name] = value;
      }
    }
  }

  return result;
}

export function hasAllRequiredVariables(
  requiredNames: string[],
  variableValues: Record<string, number>,
): boolean {
  return requiredNames.every(
    (name) => variableValues[name] !== undefined && variableValues[name] !== null,
  );
}

function extractSymbolNames(formula: string): string[] {
  const node = math.parse(formula);
  const names = new Set<string>();
  node.traverse((n) => {
    if (n.type === "SymbolNode" && "name" in n && typeof n.name === "string") {
      const name = n.name;
      if (!MATH_CONSTANTS.has(name) && !MATH_FUNCTIONS.has(name)) {
        names.add(name);
      }
    }
  });
  return [...names];
}

function assertVariablesProvided(formula: string, scope: Record<string, number>): void {
  const referenced = extractSymbolNames(formula);
  const missing = referenced.filter((name) => scope[name] === undefined);
  if (missing.length > 0) {
    throw AppError.fromCode(
      "FORMULA_MISSING_VARIABLE",
      `Missing formula variable(s): ${missing.join(", ")}`,
      { missing },
    );
  }
}

function evaluateExpression(formula: string, scope: Record<string, number>): number {
  assertVariablesProvided(formula, scope);
  let value: number;
  try {
    value = math.evaluate(formula, scope) as number;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Formula evaluation failed";
    if (message.toLowerCase().includes("divide by zero") || message.includes("Infinity")) {
      throw AppError.fromCode("FORMULA_INVALID_RESULT", "Formula produced an invalid result (division by zero)");
    }
    throw AppError.fromCode("FORMULA_INVALID_RESULT", message);
  }

  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw AppError.fromCode(
      "FORMULA_INVALID_RESULT",
      "Formula produced an invalid result (NaN or Infinity)",
    );
  }

  return value;
}

export function formatResultDisplay(result: number, precision = DEFAULT_DISPLAY_PRECISION): string {
  return result.toFixed(precision);
}

export function evaluateFormula(
  calculationFormula: string | null | undefined,
  formulaVariablesRaw: unknown,
  variableValues: Record<string, number>,
): FormulaEvaluationResult {
  const config = normalizeFormulaVariables(formulaVariablesRaw);
  const scope: Record<string, number> = { ...variableValues };

  if (config.steps && config.steps.length > 0) {
    for (const step of config.steps) {
      const stepResult = evaluateExpression(step.formula, scope);
      scope[step.name] = stepResult;
    }
    const lastStep = config.steps[config.steps.length - 1]!;
    const result = scope[lastStep.name] ?? evaluateExpression(lastStep.formula, scope);
    return { result, resultDisplay: formatResultDisplay(result) };
  }

  if (!calculationFormula) {
    throw AppError.fromCode("FORMULA_INVALID_RESULT", "No calculation formula defined for this test");
  }

  const result = evaluateExpression(calculationFormula, scope);
  return { result, resultDisplay: formatResultDisplay(result) };
}
