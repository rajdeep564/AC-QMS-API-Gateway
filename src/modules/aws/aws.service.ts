import {
  Conclusion,
  DocType,
  Prisma,
  ResultType,
  SectionStatus,
} from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { JwtAccessPayload } from "../../types/auth.types";
import { clearExpiryAcks, parseReadings } from "../../services/aws-expiry.service";
import { AuditAction, AuditEntityType, log as auditLog } from "../../services/audit.service";
import {
  evaluateQualitativeConclusion,
  evaluateQuantitativeConclusion,
} from "../../services/conclusion-evaluator";
import {
  buildVariableMapFromObservations,
  evaluateFormula,
  QuantitativeObservations,
} from "../../services/formula-engine";
import { getUserById } from "../auth/auth.service";
import {
  assertAnalystEditableStatus,
  assertEditableAwsDocument,
  assertSectionAssignee,
  rejectClientComputedFields,
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
  isOos: boolean;
  status: SectionStatus;
};

function collectVariableMap(obs: QuantitativeObservations): Record<string, number> {
  const keys = new Set<string>();
  if (obs.variables) Object.keys(obs.variables).forEach((k) => keys.add(k));
  if (obs.sets) {
    for (const set of obs.sets) Object.keys(set).forEach((k) => keys.add(k));
  }
  return buildVariableMapFromObservations([...keys], obs);
}

function getQuantitativeResult(
  spec: AwsSectionDetail["specDocumentTest"],
  readings: unknown,
): { result: number; resultDisplay: string } | null {
  const quantObs = parseReadings(readings) as QuantitativeObservations;
  const variableMap = collectVariableMap(quantObs);

  if (spec.formula) {
    try {
      return evaluateFormula(spec.formula, null, variableMap);
    } catch {
      return null;
    }
  }

  const values = Object.values(variableMap);
  if (values.length === 1 && typeof values[0] === "number") {
    const result = values[0];
    return { result, resultDisplay: result.toFixed(2) };
  }

  return null;
}

function recomputeSection(section: AwsSectionDetail, readings: unknown): RecomputeResult {
  const spec = section.specDocumentTest;
  const nextStatus =
    section.status === SectionStatus.AWAITING_CHECK ||
    section.status === SectionStatus.COMPLETE
      ? section.status
      : SectionStatus.IN_PROGRESS;

  if (spec.resultType === ResultType.QUALITATIVE) {
    const obs = parseReadings(readings) as { text?: string; passFail?: "PASS" | "FAIL" };
    const evalResult = evaluateQualitativeConclusion(obs);
    if (!evalResult) {
      return {
        calculatedResult: null,
        resultDisplay: null,
        conclusion: null,
        isOos: false,
        status: nextStatus,
      };
    }
    return {
      calculatedResult: null,
      resultDisplay: null,
      conclusion: evalResult.conclusion,
      isOos: evalResult.oosDetected,
      status: nextStatus,
    };
  }

  const quantResult = getQuantitativeResult(spec, readings);
  if (!quantResult) {
    return {
      calculatedResult: null,
      resultDisplay: null,
      conclusion: null,
      isOos: false,
      status: nextStatus,
    };
  }

  const evalResult = evaluateQuantitativeConclusion(quantResult.result, {
    resultType: spec.resultType,
    operator: spec.operator,
    minValue: spec.minValue ? Number(spec.minValue.toString()) : null,
    maxValue: spec.maxValue ? Number(spec.maxValue.toString()) : null,
  });

  return {
    calculatedResult: quantResult.result,
    resultDisplay: quantResult.resultDisplay,
    conclusion: evalResult.conclusion,
    isOos: evalResult.oosDetected,
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
  rawBody: Record<string, unknown>,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<AwsSectionDetailDto> {
  rejectClientComputedFields(rawBody);

  const section = await awsRepo.findAwsSectionById(sectionId);
  if (!section) {
    throw AppError.notFound("AWS section");
  }

  assertEditableAwsDocument(section);
  assertSectionAssignee(section, actor);
  assertAnalystEditableStatus(section);

  const mergedReadings =
    body.readings !== undefined ? body.readings : section.readings;
  const recompute = recomputeSection(section, mergedReadings);

  const updateData: Prisma.AwsSectionUpdateInput = {
    status: recompute.status,
    calculatedResult: recompute.calculatedResult,
    resultDisplay: recompute.resultDisplay,
    conclusion: recompute.conclusion,
    isOos: recompute.isOos,
  };

  if (body.readings !== undefined) {
    updateData.readings = clearExpiryAcks(body.readings) as Prisma.InputJsonValue;
  }

  if (body.instrumentId !== undefined) {
    updateData.instrument = body.instrumentId
      ? { connect: { id: body.instrumentId } }
      : { disconnect: true };
    if (body.readings === undefined && section.readings) {
      updateData.readings = clearExpiryAcks(section.readings) as Prisma.InputJsonValue;
    }
  }

  if (body.reagentId !== undefined) {
    updateData.reagent = body.reagentId
      ? { connect: { id: body.reagentId } }
      : { disconnect: true };
    if (body.readings === undefined && section.readings) {
      updateData.readings = clearExpiryAcks(section.readings) as Prisma.InputJsonValue;
    }
  }

  const updated = await awsRepo.updateAwsSection(sectionId, updateData);

  const actorUser = await getUserById(actor.userId);
  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.UPDATE,
    entityType: AuditEntityType.AWS,
    entityId: updated.batchDocumentId,
    docNo: updated.batchDocument.docNo,
    fieldChanged: recompute.calculatedResult !== null ? "calculatedResult" : "readings",
    comment: `Section ${updated.specDocumentTest.testName} data entry saved`,
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

  const recompute = recomputeSection(section, body.readings);

  return {
    calculatedResult: recompute.calculatedResult?.toString() ?? null,
    resultDisplay: recompute.resultDisplay,
    conclusion: recompute.conclusion,
    isOos: recompute.isOos,
  };
}
