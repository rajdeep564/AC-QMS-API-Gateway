import { Operator, ResultType, Role } from "@prisma/client";
import type { Db } from "../../lib/prisma-types";
import { AppError } from "../../lib/app-error";
import * as mastersRepo from "../../modules/masters/masters.repository";
import * as specsRepo from "../../modules/specs/specs.repository";
import type {
  AcceptanceCriteriaDto,
  ApprovalBlockDto,
  InlineGenerateRequestDto,
  ProductConfigDto,
  TestConfigDto,
} from "../sop-client/types";
import {
  formatDisplayDate,
  mapPersonSignature,
} from "../render-formatters";

type MasterField = { fieldKey: string; value: string | null };

type SpecTestLike = {
  id: string;
  testName: string;
  resultType: ResultType;
  operator: Operator | null;
  minValue: { toString(): string } | null;
  maxValue: { toString(): string } | null;
  uom: string | null;
  acceptanceCriteria: string | null;
  sortOrder: number;
};

type MoaSectionLike = {
  specTestId: string | null;
  pharmacopoeia: string | null;
  samplePreparation: string | null;
  standardPreparation: string | null;
  blankPreparation: string | null;
  procedureText: string | null;
  conclusionTemplate: string | null;
  additionalNotes: string | null;
  specTest?: { id: string; testName: string } | null;
};

type UserLike = { fullName: string; role: Role } | null;

function masterField(fields: MasterField[] | undefined, key: string): string | null {
  const raw = fields?.find((f) => f.fieldKey === key)?.value?.trim();
  return raw && raw.length > 0 ? raw : null;
}

function num(value: { toString(): string } | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

export function mapOperatorToAcceptance(
  test: SpecTestLike,
): AcceptanceCriteriaDto | string | null {
  if (test.resultType === ResultType.QUALITATIVE) {
    return test.acceptanceCriteria?.trim()
      ? { type: "text", value: test.acceptanceCriteria.trim() }
      : test.acceptanceCriteria;
  }

  const min = num(test.minValue);
  const max = num(test.maxValue);
  const unit = test.uom;

  switch (test.operator) {
    case Operator.BETWEEN:
      return {
        type: "between",
        min: min ?? undefined,
        max: max ?? undefined,
        unit: unit ?? undefined,
        display:
          min != null && max != null
            ? `${min} to ${max}${unit ? ` ${unit}` : ""}`
            : undefined,
      };
    case Operator.NMT:
      return {
        type: "nmt",
        value: max ?? undefined,
        max: max ?? undefined,
        unit: unit ?? undefined,
        display: max != null ? `NMT ${max}${unit ? ` ${unit}` : ""}` : undefined,
      };
    case Operator.NLT:
      return {
        type: "nlt",
        value: min ?? undefined,
        min: min ?? undefined,
        unit: unit ?? undefined,
        display: min != null ? `NLT ${min}${unit ? ` ${unit}` : ""}` : undefined,
      };
    case Operator.EQUALS:
      return {
        type: "equals",
        value: test.acceptanceCriteria ?? min ?? max ?? undefined,
      };
    case Operator.TEXT:
      return test.acceptanceCriteria
        ? { type: "text", value: test.acceptanceCriteria }
        : null;
    default:
      return test.acceptanceCriteria ?? null;
  }
}

function buildProcedure(section: MoaSectionLike | undefined): string | null {
  if (!section) return null;
  const parts = [
    section.pharmacopoeia && `Pharmacopoeia: ${section.pharmacopoeia}`,
    section.samplePreparation && `Sample prep: ${section.samplePreparation}`,
    section.standardPreparation && `Standard prep: ${section.standardPreparation}`,
    section.blankPreparation && `Blank prep: ${section.blankPreparation}`,
    section.procedureText,
    section.conclusionTemplate && `Conclusion: ${section.conclusionTemplate}`,
    section.additionalNotes,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

export function mapStandingProductConfig(input: {
  productName: string;
  fields: MasterField[];
  specNo: string;
  moaNo: string | null;
  tests: SpecTestLike[];
  moaSections: MoaSectionLike[];
}): ProductConfigDto {
  const fields = input.fields;
  const productCode = masterField(fields, "product_code");
  if (!productCode) {
    throw new Error("ACTIVE master is missing product_code");
  }

  const sectionsByTestId = new Map(
    input.moaSections.filter((s) => s.specTestId).map((s) => [s.specTestId!, s]),
  );

  const tests: TestConfigDto[] = [...input.tests]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((t) => {
      const matched = sectionsByTestId.get(t.id);
      return {
        name: t.testName,
        procedure: buildProcedure(matched),
        acceptance_criteria: mapOperatorToAcceptance(t),
        section_no: String(t.sortOrder),
      };
    });

  const metadata: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.value?.trim()) metadata[f.fieldKey] = f.value.trim();
  }

  return {
    product_code: productCode,
    product_name: masterField(fields, "product_name") ?? input.productName,
    reference: masterField(fields, "product_grade") ?? masterField(fields, "reference"),
    molecular_weight: masterField(fields, "molecular_weight"),
    chemical_formula: masterField(fields, "chemical_formula"),
    specification_no: input.specNo,
    moa_no: input.moaNo,
    department: "QUALITY ASSURANCE",
    tests,
    metadata,
  };
}

export function buildApprovalFromSpecLineage(input: {
  createdBy: UserLike;
  submittedBy: UserLike;
  qcApprovedBy: UserLike;
  qaSignedBy: UserLike;
  createdAt: Date | null;
  approvedAt: Date | null;
}): ApprovalBlockDto {
  const authoredDate = formatDisplayDate(input.createdAt) || null;
  const signedDate = formatDisplayDate(input.approvedAt) || authoredDate;
  return {
    prepared_by: mapPersonSignature(
      input.createdBy,
      input.createdBy?.role ?? Role.QC_EXEC,
      authoredDate,
    ),
    checked_by: mapPersonSignature(
      input.qcApprovedBy ?? input.submittedBy,
      (input.qcApprovedBy ?? input.submittedBy)?.role ?? Role.QC_MGR,
      signedDate,
    ),
    approved_by: mapPersonSignature(
      input.qaSignedBy,
      input.qaSignedBy?.role ?? Role.QA_MGR,
      signedDate,
    ),
  };
}

export function buildSpecGenerateRequest(input: {
  product: ProductConfigDto;
  specNo: string;
  revisionNo: number;
  effectiveDate: Date | null;
  approval: ApprovalBlockDto;
}): InlineGenerateRequestDto {
  return {
    document_type: "specification",
    product: input.product,
    document_no: input.specNo,
    revision_no: String(input.revisionNo).padStart(2, "0"),
    department: "QUALITY ASSURANCE",
    subject: `Specification — ${input.product.product_name}`,
    effective_date: input.effectiveDate
      ? input.effectiveDate.toISOString().slice(0, 10)
      : null,
    approval: input.approval,
  };
}

export function buildMoaGenerateRequest(input: {
  product: ProductConfigDto;
  moaNo: string;
  revisionNo: number;
  effectiveDate: Date | null;
  approval: ApprovalBlockDto;
}): InlineGenerateRequestDto {
  return {
    document_type: "moa",
    product: input.product,
    document_no: input.moaNo,
    revision_no: String(input.revisionNo).padStart(2, "0"),
    department: "QUALITY ASSURANCE",
    subject: `Method of Analysis — ${input.product.product_name}`,
    effective_date: input.effectiveDate
      ? input.effectiveDate.toISOString().slice(0, 10)
      : null,
    approval: input.approval,
  };
}

type StandingGenerateContext = {
  product: ProductConfigDto;
  approval: ApprovalBlockDto;
  specNo: string;
  moaNo: string;
  revisionNo: number;
  effectiveDate: Date | null;
};

/** Load standing SPEC+MOA+master and assemble ProductConfig for POST /generate. */
async function loadStandingGenerateContext(
  specId: string,
  client?: Db,
): Promise<StandingGenerateContext> {
  const spec = await specsRepo.findSpecWithMoaForRender(specId, client);
  if (!spec) throw AppError.notFound("SPEC");
  if (!spec.moaDoc) throw AppError.conflict("MOA is required before standing render");

  const master = await mastersRepo.findActiveMasterForProduct(spec.productId, client);
  if (!master) throw AppError.conflict("ACTIVE Product Master required for render");
  const masterWithFields = await mastersRepo.findMasterWithFields(master.id, client);
  const fields = masterWithFields?.fields ?? [];

  const product = mapStandingProductConfig({
    productName: spec.product.name,
    fields,
    specNo: spec.specNo,
    moaNo: spec.moaDoc.moaNo,
    tests: spec.specTests,
    moaSections: spec.moaDoc.sections,
  });

  const approval = buildApprovalFromSpecLineage({
    createdBy: spec.createdBy,
    submittedBy: spec.submittedBy,
    qcApprovedBy: spec.qcApprovedBy,
    qaSignedBy: spec.qaSignedBy,
    createdAt: spec.createdAt,
    approvedAt: spec.approvedAt,
  });

  return {
    product,
    approval,
    specNo: spec.specNo,
    moaNo: spec.moaDoc.moaNo,
    revisionNo: spec.revisionNo,
    effectiveDate: spec.effectiveDate,
  };
}

/**
 * Maps a QA_SIGNED standing SPEC to InlineGenerateRequest for DOC-Module POST /generate.
 * Contract: specification document_type + ProductConfig — not sopClient.render.
 */
export async function mapToSpecRenderInput(
  specId: string,
  client?: Db,
): Promise<InlineGenerateRequestDto> {
  const ctx = await loadStandingGenerateContext(specId, client);
  return buildSpecGenerateRequest({
    product: ctx.product,
    specNo: ctx.specNo,
    revisionNo: ctx.revisionNo,
    effectiveDate: ctx.effectiveDate,
    approval: ctx.approval,
  });
}

/**
 * Maps a QA_SIGNED standing MOA to InlineGenerateRequest for DOC-Module POST /generate.
 * Contract: moa document_type + ProductConfig — not sopClient.render.
 */
export async function mapToMoaRenderInput(
  specId: string,
  client?: Db,
): Promise<InlineGenerateRequestDto> {
  const ctx = await loadStandingGenerateContext(specId, client);
  return buildMoaGenerateRequest({
    product: ctx.product,
    moaNo: ctx.moaNo,
    revisionNo: ctx.revisionNo,
    effectiveDate: ctx.effectiveDate,
    approval: ctx.approval,
  });
}
