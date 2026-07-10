/**
 * Advisory allowedActions for AWS section GET responses (Epic 12 / US-12-x).
 * Mirrors existing guards — enforcement remains in aws-guards / compliance service.
 */
import { DocStatus, Role, SectionStatus } from "@prisma/client";
import { JwtAccessPayload } from "../../types/auth.types";
import {
  hasInstrumentExpiryAck,
  hasReagentExpiryAck,
  isInstrumentExpired,
  isReagentExpired,
  startOfUtcDay,
} from "../../services/aws-expiry.service";
import type { AwsSectionDetail } from "./aws.repository";

export const AWS_SECTION_ACTIONS = [
  "PATCH",
  "PREVIEW",
  "COMPLETE",
  "ACKNOWLEDGE_OOS",
  "ACKNOWLEDGE_EXPIRED_INSTRUMENT",
  "ACKNOWLEDGE_EXPIRED_REAGENT",
  "CHECK",
  "REJECT_CHECK",
] as const;

export type AwsSectionAction = (typeof AWS_SECTION_ACTIONS)[number];

function isAssignedAnalyst(section: AwsSectionDetail, actor: JwtAccessPayload): boolean {
  const assignedId = section.batchDocument.batch.assignedQcExecId;
  return !!assignedId && actor.userId === assignedId;
}

function isEditableDocument(section: AwsSectionDetail): boolean {
  return section.batchDocument.status === DocStatus.DRAFT;
}

function isAnalystEditableStatus(section: AwsSectionDetail): boolean {
  return (
    section.status === SectionStatus.NOT_STARTED ||
    section.status === SectionStatus.IN_PROGRESS
  );
}

/** Reflects assertNotSameAsAnalyst + assertQcChecker role requirement (QC_EXEC checker). */
function isEligibleChecker(section: AwsSectionDetail, actor: JwtAccessPayload): boolean {
  return (
    actor.role === Role.QC_EXEC &&
    section.status === SectionStatus.AWAITING_CHECK &&
    !!section.analystId &&
    actor.userId !== section.analystId
  );
}

export function getAllowedAwsSectionActions(
  section: AwsSectionDetail,
  actor: JwtAccessPayload,
): AwsSectionAction[] {
  const actions: AwsSectionAction[] = [];
  const today = startOfUtcDay();

  if (isEditableDocument(section) && isAssignedAnalyst(section, actor)) {
    if (isAnalystEditableStatus(section)) {
      actions.push("PATCH", "PREVIEW", "COMPLETE");

      if (section.isOos && !section.oosAcknowledged) {
        actions.push("ACKNOWLEDGE_OOS");
      }

      if (
        section.instrumentId &&
        section.instrument &&
        isInstrumentExpired(section.instrument, today) &&
        !hasInstrumentExpiryAck(section.readings)
      ) {
        actions.push("ACKNOWLEDGE_EXPIRED_INSTRUMENT");
      }

      if (
        section.reagentId &&
        section.reagent &&
        isReagentExpired(section.reagent, today) &&
        !hasReagentExpiryAck(section.readings)
      ) {
        actions.push("ACKNOWLEDGE_EXPIRED_REAGENT");
      }
    }
  }

  if (isEditableDocument(section) && isEligibleChecker(section, actor)) {
    actions.push("CHECK", "REJECT_CHECK");
  }

  return actions;
}
