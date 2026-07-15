import { ResultType } from "@prisma/client";
import { SectionFieldConfigDto } from "./aws.types";

type SpecTestFieldSource = {
  resultType: ResultType;
  isOutsideLab: boolean;
  formula: string | null;
};

export function buildSectionFieldConfig(spec: SpecTestFieldSource): SectionFieldConfigDto {
  const outside = spec.isOutsideLab;
  const quantitative = spec.resultType === ResultType.QUANTITATIVE;
  const qualitative = spec.resultType === ResultType.QUALITATIVE;
  const hasFormula = quantitative && !!spec.formula;

  return {
    layout: outside ? "OUTSIDE_LAB" : "IN_HOUSE",
    showInstrument: !outside,
    showReagent: !outside,
    showFormulaInputs: quantitative && (hasFormula || !spec.formula),
    showQualitativePassFail: qualitative,
    showFileUpload: true,
    requiresAttachment: outside,
  };
}

export function sectionAttachmentPathPrefix(sectionId: string): string {
  return `aws-sections/${sectionId}/`;
}

export function parseAttachmentFileName(filePath: string): string {
  const parts = filePath.split("/");
  const raw = parts[parts.length - 1] ?? filePath;
  const dash = raw.indexOf("-");
  return dash >= 0 ? raw.slice(dash + 1) : raw;
}

export function mimeTypeFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}
