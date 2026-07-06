import { DeptName, DocStatus, DocType, ResultType, SectionStatus } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { JwtAccessPayload } from "../../types/auth.types";
import {
  hasInstrumentExpiryAck,
  hasOosAcknowledgement,
  hasReagentExpiryAck,
  isInstrumentExpired,
  isReagentExpired,
  parseReadings,
  startOfUtcDay,
} from "../../services/aws-expiry.service";
import * as authRepo from "../auth/auth.repository";
import type { AwsSectionDetail } from "./aws.repository";

export function assertEditableAwsDocument(section: AwsSectionDetail): void {
  if (section.batchDocument.docType !== DocType.AWS) {
    throw AppError.notFound("AWS section");
  }
  if (section.batchDocument.status !== DocStatus.DRAFT) {
    throw AppError.conflict("AWS document must be in DRAFT status for data entry");
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
  if (section.isOos && !hasOosAcknowledgement(section.readings)) {
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

export function rejectClientComputedFields(body: Record<string, unknown>): void {
  if ("calculatedResult" in body || "conclusion" in body || "resultDisplay" in body) {
    throw AppError.validation("calculatedResult, conclusion, and resultDisplay are server-computed");
  }
}
