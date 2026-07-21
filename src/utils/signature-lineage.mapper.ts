/**
 * C-2 / US-20-9 — per-stage attribution ("actioned by / on") from signature-lineage columns.
 * No schema change: timestamps use createdAt / approvedAt plus optional audit corroboration.
 */

export type SignatureActorRef = {
  id: string;
  displayName: string;
};

export type SignatureStageDto = {
  user: SignatureActorRef | null;
  at: Date | null;
};

export type SignatureLineageDto = {
  authored: SignatureStageDto;
  submitted: SignatureStageDto;
  qcApproved: SignatureStageDto;
  qaSigned: SignatureStageDto;
};

type UserRef = { id: string; fullName: string } | null | undefined;

export type SignatureLineageInput = {
  authoredBy?: UserRef;
  authoredAt?: Date | null;
  submittedBy?: UserRef;
  submittedAt?: Date | null;
  qcApprovedBy?: UserRef;
  qcApprovedAt?: Date | null;
  qaSignedBy?: UserRef;
  qaSignedAt?: Date | null;
};

function toStage(user: UserRef, at: Date | null | undefined): SignatureStageDto {
  if (!user) {
    return { user: null, at: null };
  }
  return {
    user: { id: user.id, displayName: user.fullName },
    at: at ?? null,
  };
}

export function buildSignatureLineage(input: SignatureLineageInput): SignatureLineageDto {
  return {
    authored: toStage(input.authoredBy, input.authoredAt),
    submitted: toStage(input.submittedBy, input.submittedAt),
    qcApproved: toStage(input.qcApprovedBy, input.qcApprovedAt),
    qaSigned: toStage(input.qaSignedBy, input.qaSignedAt),
  };
}
