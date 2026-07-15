import { CreateSpecBody } from "../../src/modules/specs/specs.schema";

/** Multi-test fixture for Flow A verification (N ≥ 2). */
export const SAMPLE_SPEC_BODY: CreateSpecBody = {
  variant: "GENERAL",
  tests: [
    {
      sortOrder: 1,
      testName: "Description",
      resultType: "QUALITATIVE",
      acceptanceCriteria: "White crystalline powder",
      isOptional: false,
    },
    {
      sortOrder: 2,
      testName: "pH",
      resultType: "QUANTITATIVE",
      operator: "BETWEEN",
      minValue: 5.9,
      maxValue: 6.3,
    },
    {
      sortOrder: 3,
      testName: "Chlorides",
      resultType: "QUANTITATIVE",
      operator: "NMT",
      maxValue: 100,
      uom: "ppm",
    },
    {
      sortOrder: 4,
      testName: "Loss on drying",
      resultType: "QUANTITATIVE",
      operator: "NMT",
      maxValue: 0.5,
      uom: "%",
    },
    {
      sortOrder: 5,
      testName: "Assay",
      resultType: "QUANTITATIVE",
      operator: "BETWEEN",
      minValue: 98.5,
      maxValue: 101.5,
      uom: "%",
    },
  ],
  moaSections: [
    { specTestRef: 0, pharmacopoeia: "IP", procedureText: "Visual examination per pharmacopoeia." },
    { specTestRef: 1, pharmacopoeia: "IP", procedureText: "Measure pH at 25 °C." },
    { specTestRef: 2, pharmacopoeia: "IP", procedureText: "Limit test for chlorides." },
    { specTestRef: 3, pharmacopoeia: "IP", procedureText: "Dry at 105 °C to constant weight." },
    {
      specTestRef: 4,
      pharmacopoeia: "IP",
      procedureText: "Titrimetric assay per IP monograph.",
      formulaReference: "Result = (Titre × Factor × 100) / Sample weight",
    },
  ],
};

export const EXPECTED_TEST_COUNT = SAMPLE_SPEC_BODY.tests.length;
