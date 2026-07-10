import {
  isInstrumentExpired,
  isReagentExpired,
  parseReadings,
  startOfUtcDay,
} from "../../services/aws-expiry.service";
import { JwtAccessPayload } from "../../types/auth.types";
import { getAllowedAwsSectionActions } from "./aws-allowed-actions";
import { AwsSectionDetail } from "./aws.repository";
import {
  AwsSectionDetailDto,
  AwsSectionListItemDto,
  AwsSectionsListResponseDto,
  FormulaConfigDto,
  ResolvedLimitsDto,
} from "./aws.types";

function emptyStatusSummary() {
  return {
    NOT_STARTED: 0,
    IN_PROGRESS: 0,
    AWAITING_CHECK: 0,
    COMPLETE: 0,
  };
}

function toResolvedLimits(section: AwsSectionDetail): ResolvedLimitsDto {
  const spec = section.specDocumentTest;
  return {
    specDocumentTestId: spec.id,
    resultType: spec.resultType,
    acceptanceCriteria: spec.acceptanceCriteria,
    minValue: spec.minValue?.toString() ?? null,
    maxValue: spec.maxValue?.toString() ?? null,
    operator: spec.operator,
    uom: spec.uom,
  };
}

function toFormulaConfig(section: AwsSectionDetail): FormulaConfigDto {
  return { formula: section.specDocumentTest.formula };
}

function computeReagentExpired(section: AwsSectionDetail): boolean {
  if (!section.reagent) return false;
  return isReagentExpired(section.reagent, startOfUtcDay());
}

function computeInstrumentExpired(section: AwsSectionDetail): boolean {
  if (!section.instrument) return false;
  return isInstrumentExpired(section.instrument, startOfUtcDay());
}

function expiryAckFields(readings: unknown) {
  const parsed = parseReadings(readings) as {
    instrumentExpiredAck?: boolean;
    instrumentExpiredAckComment?: string;
    reagentExpiredAck?: boolean;
    reagentExpiredAckComment?: string;
  };
  return {
    instrumentExpiredAck: parsed.instrumentExpiredAck === true,
    instrumentExpiredAckComment: parsed.instrumentExpiredAckComment ?? null,
    reagentExpiredAck: parsed.reagentExpiredAck === true,
    reagentExpiredAckComment: parsed.reagentExpiredAckComment ?? null,
  };
}

export function toAwsSectionListItem(
  section: AwsSectionDetail,
  allowedActions: string[] = [],
): AwsSectionListItemDto {
  const limits = toResolvedLimits(section);
  const acks = expiryAckFields(section.readings);
  return {
    id: section.id,
    batchDocumentId: section.batchDocumentId,
    specDocumentTestId: section.specDocumentTestId,
    sortOrder: section.specDocumentTest.sortOrder,
    status: section.status,
    testName: section.specDocumentTest.testName,
    resultType: limits.resultType,
    limits,
    readings: section.readings,
    calculatedResult: section.calculatedResult?.toString() ?? null,
    resultDisplay: section.resultDisplay,
    conclusion: section.conclusion,
    isOos: section.isOos,
    oosAcknowledged: section.oosAcknowledged,
    oosAckComment: section.oosAckComment,
    instrumentId: section.instrumentId,
    instrumentExpired: computeInstrumentExpired(section),
    instrumentExpiredAck: acks.instrumentExpiredAck,
    instrumentExpiredAckComment: acks.instrumentExpiredAckComment,
    reagentId: section.reagentId,
    reagentExpired: computeReagentExpired(section),
    reagentExpiredAck: acks.reagentExpiredAck,
    reagentExpiredAckComment: acks.reagentExpiredAckComment,
    analystId: section.analystId,
    analyst: section.analyst
      ? { id: section.analyst.id, fullName: section.analyst.fullName }
      : null,
    checkerId: section.checkerId,
    checker: section.checker
      ? { id: section.checker.id, fullName: section.checker.fullName }
      : null,
    allowedActions,
  };
}

export function toAwsSectionDetail(
  section: AwsSectionDetail,
  actor: JwtAccessPayload,
): AwsSectionDetailDto {
  const allowedActions = getAllowedAwsSectionActions(section, actor);
  return {
    ...toAwsSectionListItem(section, allowedActions),
    formula: toFormulaConfig(section),
    batchId: section.batchDocument.batchId,
    awsDocNo: section.batchDocument.docNo,
    awsDocStatus: section.batchDocument.status,
    assignedQcExecId: section.batchDocument.batch.assignedQcExecId,
  };
}

export function toAwsSectionsListResponse(
  sections: AwsSectionDetail[],
  actor: JwtAccessPayload,
): AwsSectionsListResponseDto {
  const summary = emptyStatusSummary();
  const mapped = sections.map((section) => {
    summary[section.status] += 1;
    const allowedActions = getAllowedAwsSectionActions(section, actor);
    return toAwsSectionListItem(section, allowedActions);
  });

  return {
    sections: mapped,
    allSectionsComplete:
      sections.length > 0 && sections.every((s) => s.status === "COMPLETE"),
    sectionStatusSummary: summary,
  };
}
