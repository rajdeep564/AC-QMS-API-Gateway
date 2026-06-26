import {
  Conclusion,
  DocStatus,
  DocType,
  Prisma,
  ResultType,
  SectionStatus,
} from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { JwtAccessPayload } from "../../types/auth.types";
import { clearReagentExpiredAcks, parseReagentsUsed } from "../../services/aws-expiry.service";
import { AuditAction, AuditEntityType, log as auditLog } from "../../services/audit.service";
import {
  evaluateQualitativeConclusion,
  evaluateQuantitativeConclusion,
} from "../../services/conclusion-evaluator";
import {
  buildVariableMapFromObservations,
  evaluateFormula,
  getRequiredVariableNames,
  hasAllRequiredVariables,
  normalizeFormulaVariables,
  QuantitativeObservations,
} from "../../services/formula-engine";
import { getUserById } from "../auth/auth.service";
import {
  assertAnalystEditableStatus,
  assertEditableAwsDocument,
  assertSectionAssignee,
} from "./aws-guards";
import { toAwsSectionDetail, toAwsSectionsListResponse } from "./aws.mapper";
import { PatchAwsSectionBody, PreviewAwsSectionBody } from "./aws.schema";
import {
  AwsSectionDetailDto,
  AwsSectionPreviewDto,
  AwsSectionsListResponseDto,
} from "./aws.types";
import * as awsRepo from "./aws.repository";
import type { AwsSectionDetail } from "./aws.repository";

type RecomputeResult = {
  calculatedResult: number | null;
  resultDisplay: string | null;
  conclusion: Conclusion | null;
  oosDetected: boolean;
  status: SectionStatus;
};

function getResultType(section: AwsSectionDetail): ResultType {
  return section.specDocumentTest?.resultType ?? section.testParameter.resultType;
}

function recomputeSection(
  section: AwsSectionDetail,
  observations: unknown,
): RecomputeResult {
  const resultType = getResultType(section);
  const nextStatus =
    section.status === SectionStatus.COMPLETED ||
    section.status === SectionStatus.AWAITING_CHECK
      ? section.status
      : SectionStatus.IN_PROGRESS;

  if (resultType === ResultType.QUALITATIVE) {
    const obs = (observations ?? {}) as { text?: string; passFail?: "PASS" | "FAIL" };
    const evalResult = evaluateQualitativeConclusion(obs);
    if (!evalResult) {
      return {
        calculatedResult: null,
        resultDisplay: null,
        conclusion: null,
        oosDetected: false,
        status: nextStatus,
      };
    }
    return {
      calculatedResult: null,
      resultDisplay: null,
      conclusion: evalResult.conclusion,
      oosDetected: evalResult.oosDetected,
      status: nextStatus,
    };
  }

  const quantObs = (observations ?? {}) as QuantitativeObservations;
  const config = normalizeFormulaVariables(section.testParameter.formulaVariables);
  const requiredNames = getRequiredVariableNames(config);
  const variableMap = buildVariableMapFromObservations(requiredNames, quantObs);

  if (!hasAllRequiredVariables(requiredNames, variableMap)) {
    return {
      calculatedResult: null,
      resultDisplay: null,
      conclusion: null,
      oosDetected: false,
      status: nextStatus,
    };
  }

  const formulaResult = evaluateFormula(
    section.testParameter.calculationFormula,
    section.testParameter.formulaVariables,
    variableMap,
  );

  const spec = section.specDocumentTest;
  if (!spec) {
    throw AppError.conflict("AWS section is missing spec document test lineage");
  }

  const evalResult = evaluateQuantitativeConclusion(formulaResult.result, {
    resultType: spec.resultType,
    operator: spec.operator,
    minValue: spec.minValue ? Number(spec.minValue.toString()) : null,
    maxValue: spec.maxValue ? Number(spec.maxValue.toString()) : null,
  });

  return {
    calculatedResult: formulaResult.result,
    resultDisplay: formulaResult.resultDisplay,
    conclusion: evalResult.conclusion,
    oosDetected: evalResult.oosDetected,
    status: nextStatus,
  };
}

export async function listAwsSections(awsDocId: string): Promise<AwsSectionsListResponseDto> {
  const doc = await awsRepo.findAwsDocumentById(awsDocId);
  if (!doc || doc.docType !== DocType.AWS) {
    throw AppError.notFound("AWS document");
  }

  const sections = await awsRepo.findAwsSectionsByDocumentId(awsDocId);
  return toAwsSectionsListResponse(sections);
}

export async function getAwsSectionDetail(sectionId: string): Promise<AwsSectionDetailDto> {
  const section = await awsRepo.findAwsSectionById(sectionId);
  if (!section) {
    throw AppError.notFound("AWS section");
  }
  return toAwsSectionDetail(section);
}

export async function patchAwsSection(
  sectionId: string,
  body: PatchAwsSectionBody,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<AwsSectionDetailDto> {
  const section = await awsRepo.findAwsSectionById(sectionId);
  if (!section) {
    throw AppError.notFound("AWS section");
  }

  assertEditableAwsDocument(section);
  assertSectionAssignee(section, actor);
  assertAnalystEditableStatus(section);

  const mergedObservations =
    body.observations !== undefined ? body.observations : section.observations;
  const recompute = recomputeSection(section, mergedObservations);

  const updateData: Prisma.AwsSectionUpdateInput = {
    status: recompute.status,
    calculatedResult: recompute.calculatedResult,
    resultDisplay: recompute.resultDisplay,
    conclusion: recompute.conclusion,
    oosDetected: recompute.oosDetected,
  };

  if (body.observations !== undefined) {
    updateData.observations = body.observations as Prisma.InputJsonValue;
    updateData.oosAcknowledged = false;
    updateData.oosAcknowledgedAt = null;
  }

  if (body.instrumentId !== undefined) {
    updateData.instrument = body.instrumentId
      ? { connect: { id: body.instrumentId } }
      : { disconnect: true };
    updateData.instrumentExpiredAck = false;
  }

  if (body.reagentsUsed !== undefined) {
    const entries = parseReagentsUsed(body.reagentsUsed);
    updateData.reagentsUsed = clearReagentExpiredAcks(entries) as Prisma.InputJsonValue;
  }

  if (body.remarks !== undefined) {
    updateData.remarks = body.remarks;
  }

  const updated = await awsRepo.updateAwsSection(sectionId, updateData);

  const actorUser = await getUserById(actor.userId);
  const testName = updated.specDocumentTest?.testName ?? updated.testParameter.testName;
  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.UPDATE,
    entityType: AuditEntityType.AWS,
    entityId: updated.batchDocumentId,
    docNo: updated.batchDocument.docNo,
    fieldChanged: recompute.calculatedResult !== null ? "calculatedResult" : "observations",
    comment: `Section ${testName} data entry saved`,
    ipAddress,
  });

  return toAwsSectionDetail(updated);
}

export async function previewAwsSection(
  sectionId: string,
  body: PreviewAwsSectionBody,
  actor: JwtAccessPayload,
): Promise<AwsSectionPreviewDto> {
  const section = await awsRepo.findAwsSectionById(sectionId);
  if (!section) {
    throw AppError.notFound("AWS section");
  }

  assertEditableAwsDocument(section);
  assertSectionAssignee(section, actor);
  assertAnalystEditableStatus(section);

  const recompute = recomputeSection(section, body.observations);

  return {
    calculatedResult: recompute.calculatedResult?.toString() ?? null,
    resultDisplay: recompute.resultDisplay,
    conclusion: recompute.conclusion,
    oosDetected: recompute.oosDetected,
  };
}
