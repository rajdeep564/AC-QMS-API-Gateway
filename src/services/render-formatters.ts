/**
 * Shared display formatters for render-ready document payloads (COA, AWS).
 * Backend produces every display string; the DOC renderer computes nothing.
 */

import {
  CoaComplianceVerdict,
  Conclusion,
  ResultType,
  Role,
} from "@prisma/client";
import type { SpecDocumentTest } from "@prisma/client";
import { parseReadings } from "./aws-expiry.service";

type QualitativeReadings = {
  text?: string;
  passFail?: "PASS" | "FAIL";
  oosAckComment?: string;
};

const MONTH_LABELS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

export type PersonSignatureDto = {
  name: string | null;
  designation: string | null;
  /** Always null — handwritten signature images are deferred; audit trail is the e-signature evidence. */
  signature: null;
  date: string | null;
};

export type InstrumentDisplayInput = {
  instrumentId: string;
  name?: string | null;
  calibrationDate?: Date | null;
  useBefore?: Date | null;
};

export type ReagentDisplayInput = {
  name: string;
  lotNo?: string | null;
  expiryDate?: Date | null;
};

function decimalToString(value: { toString(): string } | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

function humanizeVariableKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatVariablePairs(variables: Record<string, number>): string {
  return Object.entries(variables)
    .map(([key, value]) => `${humanizeVariableKey(key)}: ${value}`)
    .join("; ");
}

export function formatAcceptanceLimits(specTest: SpecDocumentTest): string {
  if (specTest.resultType === ResultType.QUALITATIVE && specTest.acceptanceCriteria) {
    return specTest.acceptanceCriteria;
  }

  const min = decimalToString(specTest.minValue);
  const max = decimalToString(specTest.maxValue);
  const uom = specTest.uom ? ` ${specTest.uom}` : "";

  switch (specTest.operator) {
    case "BETWEEN":
      // TODO Epic 21 GAP 3 — client docs use "5.9 to 6.3"; code produces "Between 5.9 and 6.3".
      // Do not change until display phrasing is approved (would alter existing coa_results).
      return `Between ${min} and ${max}${uom}`;
    case "NMT":
      return `NMT ${max}${uom}`;
    case "NLT":
      return `NLT ${min}${uom}`;
    default:
      return specTest.acceptanceCriteria ?? "—";
  }
}

export function formatConclusionLabel(conclusion: Conclusion | null): string {
  switch (conclusion) {
    case Conclusion.SATISFACTORY:
      return "Satisfactory";
    case Conclusion.NOT_SATISFACTORY:
      return "Not Satisfactory";
    case Conclusion.PASS:
      return "Pass";
    case Conclusion.FAIL:
      return "Fail";
    default:
      return "—";
  }
}

export function formatSectionResult(
  resultType: ResultType,
  resultDisplay: string | null,
  readings: unknown,
): string {
  if (resultType === ResultType.QUANTITATIVE) {
    return resultDisplay ?? "—";
  }

  const obs = (readings ?? {}) as QualitativeReadings;
  if (obs.text?.trim()) return obs.text.trim();
  if (obs.passFail) return obs.passFail === "PASS" ? "Pass" : "Fail";
  return "—";
}

export function formatReadingsDisplay(readings: unknown, resultType: ResultType): string {
  const parsed = parseReadings(readings);

  if (resultType === ResultType.QUALITATIVE) {
    return parsed.text?.trim() ?? "";
  }

  const parts: string[] = [];
  if (parsed.variables && Object.keys(parsed.variables).length > 0) {
    parts.push(formatVariablePairs(parsed.variables));
  }
  if (parsed.sets && parsed.sets.length > 0) {
    parsed.sets.forEach((set, index) => {
      const formatted = formatVariablePairs(set);
      if (!formatted) return;
      const prefix = parsed.sets!.length > 1 ? `Set ${index + 1}: ` : "";
      parts.push(`${prefix}${formatted}`);
    });
  }

  return parts.join("; ");
}

export function formatDisplayDate(date: Date | null | undefined): string {
  if (!date) return "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = MONTH_LABELS[date.getUTCMonth()] ?? "";
  const year = date.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

export function formatInstrumentDisplay(instrument: InstrumentDisplayInput | null | undefined): string {
  if (!instrument) return "";

  const label = instrument.name?.trim() || "Instrument";
  const idPart = instrument.instrumentId.trim();
  const base = idPart ? `${label} ${idPart}` : label;

  const calDate = instrument.useBefore ?? instrument.calibrationDate;
  if (!calDate) return base;

  const calDisplay = formatDisplayDate(calDate);
  return calDisplay ? `${base} (Cal. due ${calDisplay})` : base;
}

export function formatReagentDisplay(reagent: ReagentDisplayInput | null | undefined): string {
  if (!reagent) return "";

  const parts = [reagent.name.trim()];
  if (reagent.lotNo?.trim()) {
    parts.push(`Lot ${reagent.lotNo.trim()}`);
  }
  if (reagent.expiryDate) {
    const exp = formatDisplayDate(reagent.expiryDate);
    if (exp) parts.push(`Exp. ${exp}`);
  }

  return parts.join(", ");
}

export function roleToDesignation(role: Role): string {
  switch (role) {
    case Role.SADMIN:
      return "System Administrator";
    case Role.QC_EXEC:
      return "QC Executive";
    case Role.QC_MGR:
      return "QC Manager";
    case Role.QA_EXEC:
      return "QA Executive";
    case Role.QA_MGR:
      return "QA Manager";
    case Role.MKT_EXEC:
      return "Marketing Executive";
    default:
      return role;
  }
}

/**
 * Maps a user + role to a render-ready PersonSignature block.
 * signature is always null — image signatures are deferred; regulated evidence is the audit trail.
 */
export function mapPersonSignature(
  user: { fullName: string } | null | undefined,
  role: Role,
  date: string | null,
): PersonSignatureDto {
  return {
    name: user?.fullName ?? null,
    designation: roleToDesignation(role),
    signature: null,
    date,
  };
}

export function projectSectionNo(sortOrder: number): string {
  return String(sortOrder);
}

export function formatComplianceRemark(verdict: CoaComplianceVerdict): string {
  return verdict === CoaComplianceVerdict.COMPLIES
    ? "Complies with the IP specification"
    : "does not comply as per IP specification";
}
