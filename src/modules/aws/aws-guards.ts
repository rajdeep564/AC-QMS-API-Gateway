import { BatchStatus, DeptName, DocStatus, DocType, ResultType, SectionStatus } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { JwtAccessPayload } from "../../types/auth.types";
import {
  hasInstrumentExpiryAck,
  hasReagentExpiryAck,
  isInstrumentExpired,
  isReagentExpired,
  parseReadings,
  startOfUtcDay,
} from "../../services/aws-expiry.service";
import * as authRepo from "../auth/auth.repository";
import { MIN_EXPIRY_ACK_COMMENT_LENGTH, MIN_OOS_ACK_COMMENT_LENGTH } from "./aws.constants";
import { buildSectionFieldConfig } from "./aws-field-config";
import { countSectionAttachments } from "./aws-attachments.service";
import type { AwsSectionDetail } from "./aws.repository";

export function assertAwsDocumentReady(doc: {
  status: DocStatus;
  batch: { status: BatchStatus };
}): void {
  if (doc.batch.status !== BatchStatus.APPROVED && doc.batch.status !== BatchStatus.RELEASED) {
    throw AppError.conflict("Batch must be QA-approved before AWS data entry");
  }
  if (doc.status === DocStatus.PENDING) {
    throw AppError.conflict("AWS document is not yet open for data entry");
  }
}

export function assertAwsBatchReady(section: AwsSectionDetail): void {
  assertAwsDocumentReady({
    status: section.batchDocument.status,
    batch: { status: section.batchDocument.batch.status },
  });
}

export async function assertAttachmentRequired(section: AwsSectionDetail): Promise<void> {
  const config = buildSectionFieldConfig({
    resultType: section.specDocumentTest.resultType,
    isOutsideLab: section.specDocumentTest.isOutsideLab,
    formula: section.specDocumentTest.formula,
  });
  if (!config.requiresAttachment) return;

  const count = await countSectionAttachments(section.id);
  if (count === 0) {
    throw AppError.validation("Outside-lab section requires a supporting file attachment");
  }
}

export function assertOutsideLabReadings(section: AwsSectionDetail): void {
  const config = buildSectionFieldConfig({
    resultType: section.specDocumentTest.resultType,
    isOutsideLab: section.specDocumentTest.isOutsideLab,
    formula: section.specDocumentTest.formula,
  });
  if (config.layout !== "OUTSIDE_LAB") return;

  const readings = parseReadings(section.readings) as {
    externalReportNo?: string;
    analysisDate?: string;
  };
  if (!readings.externalReportNo?.trim()) {
    throw AppError.validation("External report number is required for outside-lab sections");
  }
  if (!readings.analysisDate?.trim()) {
    throw AppError.validation("Analysis date is required for outside-lab sections");
  }
}

export function assertEditableAwsDocument(section: AwsSectionDetail): void {
  assertAwsBatchReady(section);
  if (section.batchDocument.docType !== DocType.AWS) {
    throw AppError.notFound("AWS section");
  }
  if (section.batchDocument.status !== DocStatus.DRAFT) {
    throw AppError.conflict("AWS document must be in DRAFT status for data entry");
  }
}

/** C-4: QC Manager may edit while AWS is not yet QA_SIGNED. */
export function assertManagerEditableAwsDocument(section: AwsSectionDetail): void {
  assertAwsBatchReady(section);
  if (section.batchDocument.docType !== DocType.AWS) {
    throw AppError.notFound("AWS section");
  }
  if (section.batchDocument.status === DocStatus.QA_SIGNED) {
    throw AppError.conflict("AWS document cannot be edited after QA signature");
  }
  if (
    section.batchDocument.status !== DocStatus.DRAFT &&
    section.batchDocument.status !== DocStatus.SUBMITTED &&
    section.batchDocument.status !== DocStatus.QC_APPROVED
  ) {
    throw AppError.conflict("AWS document is not open for manager edit");
  }
}

export function assertAnalystEditableStatus(section: AwsSectionDetail): void {
  if (
    section.status === SectionStatus.AWAITING_CHECK ||
    section.status === SectionStatus.COMPLETE
  ) {
    throw AppError.sectionLocked();
  }
}

export function assertSectionAssignee(section: AwsSectionDetail, actor: JwtAccessPayload): void {
  const assignedId = section.batchDocument.batch.assignedQcExecId;
  if (!assignedId || actor.userId !== assignedId) {
    throw AppError.sectionNotAssignee();
  }
}

export async function assertQcChecker(actor: JwtAccessPayload): Promise<void> {
  const user = await authRepo.findUserById(actor.userId);
  if (!user || user.role !== actor.role || user.department?.name !== DeptName.QC) {
    throw AppError.forbidden("Checker must be a QC executive in the QC department");
  }
}

export function assertNotSameAsAnalyst(section: AwsSectionDetail, actor: JwtAccessPayload): void {
  if (section.analystId && section.analystId === actor.userId) {
    throw AppError.sameAsAnalyst();
  }
}

export function assertSectionHasConclusion(section: AwsSectionDetail): void {
  if (section.conclusion) return;

  const resultType = section.specDocumentTest.resultType;
  if (resultType === ResultType.QUALITATIVE) {
    const readings = parseReadings(section.readings);
    if (readings.passFail) return;
  }

  throw AppError.sectionIncomplete();
}

export async function assertExpiryAcknowledged(section: AwsSectionDetail): Promise<void> {
  const today = startOfUtcDay();
  const readings = section.readings;

  if (section.instrumentId && section.instrument) {
    if (isInstrumentExpired(section.instrument, today) && !hasInstrumentExpiryAck(readings)) {
      throw AppError.expiredNotAcknowledged();
    }
  }

  if (section.reagentId && section.reagent) {
    if (isReagentExpired(section.reagent, today) && !hasReagentExpiryAck(readings)) {
      throw AppError.expiredNotAcknowledged();
    }
  }
}

export function assertOosAcknowledged(section: AwsSectionDetail): void {
  if (section.isOos && !section.oosAcknowledged) {
    throw AppError.oosNotAcknowledged();
  }
}

export function assertCompleteableStatus(section: AwsSectionDetail): void {
  if (
    section.status !== SectionStatus.NOT_STARTED &&
    section.status !== SectionStatus.IN_PROGRESS
  ) {
    throw AppError.conflict("Section cannot be completed in its current status");
  }
}

export function assertAwaitingCheck(section: AwsSectionDetail): void {
  if (section.status !== SectionStatus.AWAITING_CHECK) {
    throw AppError.notAwaitingCheck();
  }
}

/** Dev-only: allow reject-check on COMPLETE sections for demo autofill rework. */
export function assertRejectCheckable(section: AwsSectionDetail): void {
  if (section.status === SectionStatus.AWAITING_CHECK) return;
  if (
    process.env.NODE_ENV === "development" &&
    section.status === SectionStatus.COMPLETE
  ) {
    return;
  }
  throw AppError.notAwaitingCheck();
}

export function rejectClientComputedFields(body: Record<string, unknown>): void {
  if ("calculatedResult" in body || "conclusion" in body || "resultDisplay" in body) {
    throw AppError.validation("calculatedResult, conclusion, and resultDisplay are server-computed");
  }
}

/** US-12-12: substantive OOS acknowledgement comment. */
export function validateOosAckComment(comment: string): void {
  if (comment.trim().length < MIN_OOS_ACK_COMMENT_LENGTH) {
    throw AppError.validation(
      `OOS acknowledgement comment must be at least ${MIN_OOS_ACK_COMMENT_LENGTH} characters`,
    );
  }
}

/** US-7-8: substantive expired instrument/reagent acknowledgement comment. */
export function validateExpiryAckComment(comment: string): void {
  if (comment.trim().length < MIN_EXPIRY_ACK_COMMENT_LENGTH) {
    throw AppError.validation(
      `Expiry acknowledgement comment must be at least ${MIN_EXPIRY_ACK_COMMENT_LENGTH} characters`,
    );
  }
}
