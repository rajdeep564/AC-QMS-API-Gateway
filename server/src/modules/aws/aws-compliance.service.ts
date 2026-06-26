import { Prisma, SectionStatus } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { JwtAccessPayload } from "../../types/auth.types";
import {
  acknowledgeReagentExpired,
  isInstrumentExpired,
  isReagentExpired,
  parseReagentsUsed,
  startOfUtcDay,
} from "../../services/aws-expiry.service";
import { AuditAction, AuditEntityType, log as auditLog } from "../../services/audit.service";
import { verifyUserPassword } from "../auth/auth.service";
import { getUserById } from "../auth/auth.service";
import {
  assertAwaitingCheck,
  assertCompleteableStatus,
  assertEditableAwsDocument,
  assertExpiryAcknowledged,
  assertNotSameAsAnalyst,
  assertOosAcknowledged,
  assertQcChecker,
  assertSectionAssignee,
  assertSectionHasConclusion,
} from "./aws-guards";
import {
  AcknowledgeExpiredBody,
  AcknowledgeOosBody,
  RejectCheckBody,
} from "./aws.schema";
import { toAwsSectionDetail } from "./aws.mapper";
import { AwsSectionDetailDto } from "./aws.types";
import * as awsRepo from "./aws.repository";
import { TransitionBody } from "../masters/masters.schema";

async function auditSectionAction(
  section: Awaited<ReturnType<typeof awsRepo.updateAwsSection>>,
  actor: JwtAccessPayload,
  action: AuditAction,
  comment: string,
  ipAddress?: string,
): Promise<void> {
  const actorUser = await getUserById(actor.userId);
  const testName = section.specDocumentTest?.testName ?? section.testParameter.testName;
  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action,
    entityType: AuditEntityType.AWS,
    entityId: section.batchDocumentId,
    docNo: section.batchDocument.docNo,
    comment: `${testName}: ${comment}`,
    ipAddress,
  });
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

  const today = startOfUtcDay();
  const updateData: Prisma.AwsSectionUpdateInput = {};

  if (body.type === "instrument") {
    if (!section.instrumentId || !section.instrument) {
      throw AppError.conflict("Section has no instrument assigned");
    }
    if (!isInstrumentExpired(section.instrument, today)) {
      throw AppError.conflict("Instrument is not expired");
    }
    updateData.instrumentExpiredAck = true;
  } else {
    if (!body.reagentId) {
      throw AppError.validation({ message: "reagentId is required for reagent acknowledgement" });
    }
    const reagent = await awsRepo.findReagentById(body.reagentId);
    if (!reagent) throw AppError.notFound("Reagent");
    if (!isReagentExpired(reagent, today)) {
      throw AppError.conflict("Reagent is not expired");
    }
    const entries = parseReagentsUsed(section.reagentsUsed);
    updateData.reagentsUsed = acknowledgeReagentExpired(entries, body.reagentId, body.comment);
  }

  const updated = await awsRepo.updateAwsSection(sectionId, updateData);
  await auditSectionAction(
    updated,
    actor,
    AuditAction.ACKNOWLEDGE_EXPIRED,
    `${body.type} expired acknowledged: ${body.comment}`,
    ipAddress,
  );

  return toAwsSectionDetail(updated);
}

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

  if (!section.oosDetected) {
    throw AppError.conflict("Section does not have an out-of-specification result");
  }

  const updated = await awsRepo.updateAwsSection(sectionId, {
    oosAcknowledged: true,
    oosAcknowledgedAt: new Date(),
  });

  await auditSectionAction(
    updated,
    actor,
    AuditAction.ACKNOWLEDGE_OOS,
    body.comment ?? "OOS acknowledged",
    ipAddress,
  );

  return toAwsSectionDetail(updated);
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

  const now = new Date();
  const updated = await awsRepo.updateAwsSection(sectionId, {
    status: SectionStatus.AWAITING_CHECK,
    analyzedBy: { connect: { id: actor.userId } },
    completedAt: now,
  });

  await auditSectionAction(updated, actor, AuditAction.COMPLETE_SECTION, "Analyst completed section", ipAddress);

  return toAwsSectionDetail(updated);
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

  const updated = await awsRepo.updateAwsSection(sectionId, {
    status: SectionStatus.COMPLETED,
    checkedBy: { connect: { id: actor.userId } },
  });

  await auditSectionAction(updated, actor, AuditAction.CHECK_SECTION, "Checker verified section", ipAddress);

  return toAwsSectionDetail(updated);
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
  assertAwaitingCheck(section);

  const rejectNote = `[Checker reject]: ${body.comment}`;
  const updated = await awsRepo.updateAwsSection(sectionId, {
    status: SectionStatus.IN_PROGRESS,
    analyzedBy: { disconnect: true },
    checkedBy: { disconnect: true },
    completedAt: null,
    remarks: section.remarks ? `${rejectNote}\n${section.remarks}` : rejectNote,
  });

  await auditSectionAction(
    updated,
    actor,
    AuditAction.REJECT_CHECK,
    body.comment,
    ipAddress,
  );

  return toAwsSectionDetail(updated);
}
