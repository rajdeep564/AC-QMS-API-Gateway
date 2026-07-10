import { AppError } from "../../lib/app-error";
import {
  getRequiredVariableNames,
  normalizeFormulaVariables,
} from "../../services/formula-engine";
import { create, all } from "mathjs";
import type { SpecTestInput } from "./specs.repository";

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

function extractFormulaSymbolNames(formula: string): string[] {
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

/** US-5-9 — AppError.validation() stores strings in details; use fromCode for human-readable messages. */
function validationError(message: string): AppError {
  return AppError.fromCode("VALIDATION_ERROR", message);
}

/** US-5-9 — syntax + declared-variable validation at SPEC author/PATCH (not cross-test or units). */
export function validateSpecTestFormulaAtSave(test: Pick<SpecTestInput, "testName" | "formula" | "formulaVariables">): void {
  const formula = test.formula?.trim();
  if (!formula) return;

  try {
    math.parse(formula);
  } catch {
    throw validationError(`Test "${test.testName}": formula is not parseable`);
  }

  const config = normalizeFormulaVariables(test.formulaVariables);
  const declared = new Set(getRequiredVariableNames(config));
  for (const step of config.steps ?? []) {
    try {
      math.parse(step.formula);
    } catch {
      throw validationError(`Test "${test.testName}": step formula for "${step.name}" is not parseable`);
    }
    for (const symbol of extractFormulaSymbolNames(step.formula)) {
      if (!declared.has(symbol)) {
        throw validationError(
          `Test "${test.testName}": formula references undeclared variable "${symbol}"`,
        );
      }
    }
  }

  for (const symbol of extractFormulaSymbolNames(formula)) {
    if (!declared.has(symbol)) {
      throw validationError(
        `Test "${test.testName}": formula references undeclared variable "${symbol}"`,
      );
    }
  }
}

/** US-5-1 — reject duplicate sort_order; assign contiguous 1..n inside caller tx. */
export function normalizeSpecTestSortOrders(tests: SpecTestInput[]): SpecTestInput[] {
  const indexed = tests.map((test, index) => ({ test, index }));
  indexed.sort((a, b) => a.test.sortOrder - b.test.sortOrder || a.index - b.index);

  const seen = new Set<number>();
  for (const { test } of indexed) {
    if (seen.has(test.sortOrder)) {
      throw validationError(`Duplicate sort_order ${test.sortOrder} on test "${test.testName}"`);
    }
    seen.add(test.sortOrder);
  }

  return indexed.map(({ test }, position) => ({
    ...test,
    sortOrder: position + 1,
  }));
}

export function validateSpecContentAtSave(tests: SpecTestInput[]): SpecTestInput[] {
  const normalized = normalizeSpecTestSortOrders(tests);
  for (const test of normalized) {
    validateSpecTestFormulaAtSave(test);
  }
  return normalized;
}
