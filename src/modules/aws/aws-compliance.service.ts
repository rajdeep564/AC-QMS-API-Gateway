import { Prisma, SectionStatus } from "@prisma/client";
import { prisma, type Tx } from "../../lib/prisma-types";
import { AppError } from "../../lib/app-error";
import { JwtAccessPayload } from "../../types/auth.types";
import {
  acknowledgeInstrumentExpired,
  acknowledgeReagentExpired,
  isInstrumentExpired,
  isReagentExpired,
  startOfUtcDay,
} from "../../services/aws-expiry.service";
import { AuditAction, AuditEntityType, log as auditLog } from "../../services/audit.service";
import { getUserById, verifyUserPassword } from "../auth/auth.service";
import {
  assertAwaitingCheck,
  assertAttachmentRequired,
  assertCompleteableStatus,
  assertEditableAwsDocument,
  assertExpiryAcknowledged,
  assertNotSameAsAnalyst,
  assertOosAcknowledged,
  assertOutsideLabReadings,
  assertQcChecker,
  assertRejectCheckable,
  assertSectionAssignee,
  assertSectionHasConclusion,
  validateExpiryAckComment,
  validateOosAckComment,
} from "./aws-guards";
import { AcknowledgeExpiredBody, AcknowledgeOosBody, RejectCheckBody } from "./aws.schema";
import { toAwsSectionDetail } from "./aws.mapper";
import { AwsSectionDetailDto } from "./aws.types";
import * as awsRepo from "./aws.repository";
import { TransitionBody } from "../masters/masters.schema";

async function auditSectionAction(
  section: Awaited<ReturnType<typeof awsRepo.updateAwsSection>>,
  actor: JwtAccessPayload,
  action: AuditAction,
  comment: string,
  tx: Tx,
  ipAddress?: string,
): Promise<void> {
  const actorUser = await getUserById(actor.userId);
  await auditLog(
    {
      userId: actor.userId,
      userName: actorUser?.fullName,
      role: actor.role,
      department: actorUser?.department?.name,
      action,
      entityType: AuditEntityType.AWS,
      entityId: section.batchDocumentId,
      docNo: section.batchDocument.docNo,
      comment: `${section.specDocumentTest.testName}: ${comment}`,
      ipAddress,
    },
    tx,
  );
}

export async function acknowledgeExpiredSection(
  sectionId: string,
  body: AcknowledgeExpiredBody,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<AwsSectionDetailDto> {
  const section = await awsRepo.findAwsSectionById(sectionId);
  if (!section) throw AppError.notFound("AWS section");

  assertEditableAwsDocument(section);
  assertSectionAssignee(section, actor);
  validateExpiryAckComment(body.comment);

  const today = startOfUtcDay();
  const updateData: Prisma.AwsSectionUpdateInput = {};

  if (body.type === "instrument") {
    if (!section.instrumentId || !section.instrument) {
      throw AppError.conflict("Section has no instrument assigned");
    }
    if (!isInstrumentExpired(section.instrument, today)) {
      throw AppError.conflict("Instrument is not expired");
    }
    updateData.readings = acknowledgeInstrumentExpired(section.readings, body.comment);
  } else {
    if (!section.reagentId || !section.reagent) {
      throw AppError.conflict("Section has no reagent assigned");
    }
    if (!isReagentExpired(section.reagent, today)) {
      throw AppError.conflict("Reagent is not expired");
    }
    updateData.readings = acknowledgeReagentExpired(section.readings, body.comment);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await awsRepo.updateAwsSection(sectionId, updateData, tx);
    await auditSectionAction(
      row,
      actor,
      AuditAction.ACKNOWLEDGE_EXPIRED,
      `${body.type} expired acknowledged: ${body.comment}`,
      tx,
      ipAddress,
    );
    return row;
  });

  return toAwsSectionDetail(updated, actor);
}

/** US-12-12: OOS acknowledgement stored on dedicated columns with timestamp. */
export async function acknowledgeOosSection(
  sectionId: string,
  body: AcknowledgeOosBody,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<AwsSectionDetailDto> {
  const section = await awsRepo.findAwsSectionById(sectionId);
  if (!section) throw AppError.notFound("AWS section");

  assertEditableAwsDocument(section);
  assertSectionAssignee(section, actor);
  validateOosAckComment(body.comment);

  if (!section.isOos) {
    throw AppError.conflict("Section does not have an out-of-specification result");
  }

  const acknowledgedAt = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const row = await awsRepo.updateAwsSection(
      sectionId,
      {
        oosAcknowledged: true,
        oosAcknowledgedAt: acknowledgedAt,
        oosAckComment: body.comment.trim(),
      },
      tx,
    );
    await auditSectionAction(row, actor, AuditAction.ACKNOWLEDGE_OOS, body.comment, tx, ipAddress);
    return row;
  });

  return toAwsSectionDetail(updated, actor);
}

export async function completeAwsSection(
  sectionId: string,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<AwsSectionDetailDto> {
  const section = await awsRepo.findAwsSectionById(sectionId);
  if (!section) throw AppError.notFound("AWS section");

  assertEditableAwsDocument(section);
  assertSectionAssignee(section, actor);
  assertCompleteableStatus(section);
  assertSectionHasConclusion(section);
  assertOosAcknowledged(section);
  await assertExpiryAcknowledged(section);
  assertOutsideLabReadings(section);
  await assertAttachmentRequired(section);

  const updated = await prisma.$transaction(async (tx) => {
    const row = await awsRepo.updateAwsSection(
      sectionId,
      {
        status: SectionStatus.AWAITING_CHECK,
        analyst: { connect: { id: actor.userId } },
      },
      tx,
    );
    await auditSectionAction(
      row,
      actor,
      AuditAction.COMPLETE_SECTION,
      "Analyst completed section",
      tx,
      ipAddress,
    );
    return row;
  });

  return toAwsSectionDetail(updated, actor);
}

export async function checkAwsSection(
  sectionId: string,
  body: TransitionBody,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<AwsSectionDetailDto> {
  const section = await awsRepo.findAwsSectionById(sectionId);
  if (!section) throw AppError.notFound("AWS section");

  assertEditableAwsDocument(section);
  await assertQcChecker(actor);
  assertNotSameAsAnalyst(section, actor);
  assertAwaitingCheck(section);
  await verifyUserPassword(actor.userId, body.password);

  const updated = await prisma.$transaction(async (tx) => {
    const row = await awsRepo.updateAwsSection(
      sectionId,
      {
        status: SectionStatus.COMPLETE,
        checker: { connect: { id: actor.userId } },
      },
      tx,
    );
    await auditSectionAction(
      row,
      actor,
      AuditAction.CHECK_SECTION,
      "Checker verified section",
      tx,
      ipAddress,
    );
    return row;
  });

  return toAwsSectionDetail(updated, actor);
}

export async function rejectCheckAwsSection(
  sectionId: string,
  body: RejectCheckBody,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<AwsSectionDetailDto> {
  const section = await awsRepo.findAwsSectionById(sectionId);
  if (!section) throw AppError.notFound("AWS section");

  assertEditableAwsDocument(section);
  await assertQcChecker(actor);
  assertNotSameAsAnalyst(section, actor);
  assertRejectCheckable(section);

  const updated = await prisma.$transaction(async (tx) => {
    const row = await awsRepo.updateAwsSection(
      sectionId,
      {
        status: SectionStatus.IN_PROGRESS,
        analyst: { disconnect: true },
        checker: { disconnect: true },
      },
      tx,
    );
    await auditSectionAction(row, actor, AuditAction.REJECT_CHECK, body.comment, tx, ipAddress);
    return row;
  });

  return toAwsSectionDetail(updated, actor);
}
