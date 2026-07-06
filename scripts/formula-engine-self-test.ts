import { AppError } from "../src/lib/app-error";
import {
  buildVariableMapFromObservations,
  evaluateFormula,
  getRequiredVariableNames,
  normalizeFormulaVariables,
} from "../src/services/formula-engine";

const ASSAY_FORMULA = "(sample_titrant_volume / std_titrant_volume) * std_concentration * 100";
const ASSAY_VARS = {
  variables: [
    { name: "std_concentration", label: "Standard concentration", uom: "mg/ml" },
    { name: "sample_titrant_volume", label: "Sample titrant volume", uom: "ml" },
    { name: "std_titrant_volume", label: "Standard titrant volume", uom: "ml" },
  ],
};

function assertClose(actual: number, expected: number, tolerance = 0.01): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

function runTest(name: string, fn: () => void): void {
  fn();
  console.log(`  PASS: ${name}`);
}

console.log("Formula engine self-tests\n");

runTest("Assay formula with known inputs → ~100.42%", () => {
  const config = normalizeFormulaVariables(ASSAY_VARS);
  const required = getRequiredVariableNames(config);
  const variableMap = buildVariableMapFromObservations(required, {
    variables: {
      sample_titrant_volume: 24.5,
      std_titrant_volume: 24.5,
      std_concentration: 1.0042,
    },
  });
  const result = evaluateFormula(ASSAY_FORMULA, ASSAY_VARS, variableMap);
  console.log(
    `    Inputs: sample=24.50, std=24.50, conc=1.0042 → result=${result.resultDisplay}% (raw=${result.result})`,
  );
  assertClose(result.result, 100.42, 0.001);
});

runTest("Missing variable → FORMULA_MISSING_VARIABLE", () => {
  try {
    evaluateFormula(ASSAY_FORMULA, ASSAY_VARS, { std_titrant_volume: 24.5 });
    throw new Error("Should have thrown");
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== "FORMULA_MISSING_VARIABLE") {
      throw err;
    }
    console.log(`    Missing: ${JSON.stringify(err.details)}`);
  }
});

runTest("Divide by zero → FORMULA_INVALID_RESULT", () => {
  try {
    evaluateFormula("A / B", { variables: [{ name: "A" }, { name: "B" }] }, { A: 1, B: 0 });
    throw new Error("Should have thrown");
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== "FORMULA_INVALID_RESULT") {
      throw err;
    }
    console.log(`    Message: ${err.message}`);
  }
});

runTest("Multi-step formula → correct sequenced result", () => {
  const config = {
    variables: [
      { name: "A_sample", label: "Sample absorbance" },
      { name: "A_standard", label: "Standard absorbance" },
      { name: "Purity", label: "Standard purity", uom: "%" },
    ],
    steps: [
      { name: "ratio", formula: "A_sample / A_standard" },
      { name: "result", formula: "ratio * Purity" },
    ],
  };
  const required = getRequiredVariableNames(normalizeFormulaVariables(config));
  const variableMap = buildVariableMapFromObservations(required, {
    variables: { A_sample: 1234, A_standard: 1200, Purity: 99.5 },
  });
  const result = evaluateFormula(null, config, variableMap);
  console.log(
    `    Steps: ratio=1234/1200, result=ratio*99.5 → ${result.resultDisplay} (raw=${result.result})`,
  );
  assertClose(result.result, 102.31916666666667, 0.001);
});

runTest("Replicate sets → arithmetic mean", () => {
  const config = normalizeFormulaVariables({ variables: [{ name: "x" }, { name: "y" }] });
  const required = getRequiredVariableNames(config);
  const variableMap = buildVariableMapFromObservations(required, {
    sets: [{ x: 10, y: 20 }, { x: 20, y: 40 }],
  });
  if (variableMap.x !== 15 || variableMap.y !== 30) {
    throw new Error(`Expected mean x=15 y=30, got x=${variableMap.x} y=${variableMap.y}`);
  }
  console.log(`    sets mean: x=15, y=30`);
});

console.log("\nAll formula engine self-tests passed.");
