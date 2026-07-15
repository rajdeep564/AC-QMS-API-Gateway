import {
  isInstrumentExpired,
  isReagentExpired,
  parseReadings,
  startOfUtcDay,
} from "../../services/aws-expiry.service";
import { JwtAccessPayload } from "../../types/auth.types";
import { getAllowedAwsSectionActions } from "./aws-allowed-actions";
import { buildSectionFieldConfig } from "./aws-field-config";
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
  extras: {
    procedureSnapshot?: string | null;
    attachmentCount?: number;
  } = {},
): AwsSectionListItemDto {
  const limits = toResolvedLimits(section);
  const acks = expiryAckFields(section.readings);
  const sectionFieldConfig = buildSectionFieldConfig({
    resultType: section.specDocumentTest.resultType,
    isOutsideLab: section.specDocumentTest.isOutsideLab,
    formula: section.specDocumentTest.formula,
  });
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
    sectionFieldConfig,
    procedureSnapshot: extras.procedureSnapshot ?? null,
    attachmentCount: extras.attachmentCount ?? 0,
  };
}

export async function toAwsSectionListItemWithCounts(
  section: AwsSectionDetail,
  allowedActions: string[] = [],
  procedureSnapshot: string | null = null,
): Promise<AwsSectionListItemDto> {
  const { countSectionAttachments } = await import("./aws-attachments.service");
  const attachmentCount = await countSectionAttachments(section.id);
  return toAwsSectionListItem(section, allowedActions, {
    procedureSnapshot,
    attachmentCount,
  });
}

export function toAwsSectionDetail(
  section: AwsSectionDetail,
  actor: JwtAccessPayload,
  extras: {
    procedureSnapshot?: string | null;
    attachmentCount?: number;
  } = {},
): AwsSectionDetailDto {
  const allowedActions = getAllowedAwsSectionActions(section, actor);
  return {
    ...toAwsSectionListItem(section, allowedActions, extras),
    formula: toFormulaConfig(section),
    batchId: section.batchDocument.batchId,
    awsDocNo: section.batchDocument.docNo,
    awsDocStatus: section.batchDocument.status,
    assignedQcExecId: section.batchDocument.batch.assignedQcExecId,
  };
}

export async function toAwsSectionsListResponse(
  sections: AwsSectionDetail[],
  actor: JwtAccessPayload,
  moaByTestId: Map<string, string | null>,
): Promise<AwsSectionsListResponseDto> {
  const summary = emptyStatusSummary();
  const mapped = await Promise.all(
    sections.map(async (section) => {
      summary[section.status] += 1;
      const allowedActions = getAllowedAwsSectionActions(section, actor);
      const procedureSnapshot =
        moaByTestId.get(section.specDocumentTestId) ?? null;
      return toAwsSectionListItemWithCounts(section, allowedActions, procedureSnapshot);
    }),
  );

  return {
    sections: mapped,
    allSectionsComplete:
      sections.length > 0 && sections.every((s) => s.status === "COMPLETE"),
    sectionStatusSummary: summary,
  };
}
