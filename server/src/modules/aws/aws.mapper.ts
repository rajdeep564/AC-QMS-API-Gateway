import {
  isInstrumentExpired,
  isReagentExpired,
  parseReagentsUsed,
  startOfUtcDay,
} from "../../services/aws-expiry.service";
import {
  normalizeFormulaVariables,
  type FormulaVariablesConfig,
} from "../../services/formula-engine";
import { AwsSectionDetail } from "./aws.repository";
import {
  AwsSectionDetailDto,
  AwsSectionListItemDto,
  AwsSectionsListResponseDto,
  AwsSectionStatusSummary,
  FormulaConfigDto,
  ResolvedLimitsDto,
} from "./aws.types";
import * as awsRepo from "./aws.repository";

function emptyStatusSummary(): AwsSectionStatusSummary {
  return {
    NOT_STARTED: 0,
    IN_PROGRESS: 0,
    AWAITING_CHECK: 0,
    COMPLETED: 0,
  };
}

function toResolvedLimits(section: AwsSectionDetail): ResolvedLimitsDto {
  const spec = section.specDocumentTest;
  return {
    specDocumentTestId: section.specDocumentTestId,
    resultType: spec?.resultType ?? section.testParameter.resultType,
    acceptanceCriteria: spec?.acceptanceCriteria ?? null,
    minValue: spec?.minValue?.toString() ?? null,
    maxValue: spec?.maxValue?.toString() ?? null,
    operator: spec?.operator ?? null,
    uom: spec?.uom ?? section.testParameter.uom ?? null,
  };
}

function toFormulaConfig(section: AwsSectionDetail): FormulaConfigDto {
  const normalized: FormulaVariablesConfig = normalizeFormulaVariables(
    section.testParameter.formulaVariables,
  );
  return {
    calculationFormula: section.testParameter.calculationFormula,
    variables: normalized.variables,
    steps: normalized.steps,
  };
}

export async function computeReagentExpiredFlag(section: AwsSectionDetail): Promise<boolean> {
  const entries = parseReagentsUsed(section.reagentsUsed);
  if (entries.length === 0) return false;
  const reagents = await awsRepo.findReagentsByIds(entries.map((e) => e.reagentId));
  const today = startOfUtcDay();
  return reagents.some((r) => isReagentExpired(r, today));
}

export function computeInstrumentExpiredFlag(section: AwsSectionDetail): boolean {
  if (!section.instrument) return false;
  return isInstrumentExpired(section.instrument, startOfUtcDay());
}

export async function toAwsSectionListItem(section: AwsSectionDetail): Promise<AwsSectionListItemDto> {
  const limits = toResolvedLimits(section);
  return {
    id: section.id,
    batchDocumentId: section.batchDocumentId,
    testParameterId: section.testParameterId,
    specDocumentTestId: section.specDocumentTestId,
    sortOrder: section.sortOrder,
    status: section.status,
    testName: section.specDocumentTest?.testName ?? section.testParameter.testName,
    resultType: limits.resultType,
    limits,
    observations: section.observations,
    calculatedResult: section.calculatedResult?.toString() ?? null,
    resultDisplay: section.resultDisplay,
    conclusion: section.conclusion,
    oosDetected: section.oosDetected,
    oosAcknowledged: section.oosAcknowledged,
    oosAcknowledgedAt: section.oosAcknowledgedAt?.toISOString() ?? null,
    instrumentId: section.instrumentId,
    instrumentExpired: computeInstrumentExpiredFlag(section),
    instrumentExpiredAck: section.instrumentExpiredAck,
    reagentsUsed: section.reagentsUsed,
    reagentExpired: await computeReagentExpiredFlag(section),
    remarks: section.remarks,
    analyzedById: section.analyzedById,
    analyzedBy: section.analyzedBy
      ? { id: section.analyzedBy.id, fullName: section.analyzedBy.fullName }
      : null,
    checkedById: section.checkedById,
    checkedBy: section.checkedBy
      ? { id: section.checkedBy.id, fullName: section.checkedBy.fullName }
      : null,
    completedAt: section.completedAt?.toISOString() ?? null,
  };
}

export async function toAwsSectionDetail(
  section: AwsSectionDetail,
  allowedActions: string[] = [],
): Promise<AwsSectionDetailDto> {
  return {
    ...(await toAwsSectionListItem(section)),
    formula: toFormulaConfig(section),
    batchId: section.batchDocument.batchId,
    awsDocNo: section.batchDocument.docNo,
    awsDocStatus: section.batchDocument.status,
    assignedQcExecId: section.batchDocument.batch.assignedQcExecId,
    allowedActions: allowedActions as AwsSectionDetailDto["allowedActions"],
  };
}

export async function toAwsSectionsListResponse(
  sections: AwsSectionDetail[],
): Promise<AwsSectionsListResponseDto> {
  const summary = emptyStatusSummary();
  const mapped: AwsSectionListItemDto[] = [];

  for (const section of sections) {
    summary[section.status] += 1;
    mapped.push(await toAwsSectionListItem(section));
  }

  return {
    sections: mapped,
    allSectionsComplete: sections.length > 0 && sections.every((s) => s.status === "COMPLETED"),
    sectionStatusSummary: summary,
  };
}
