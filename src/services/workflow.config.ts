import { DocType, Role } from "@prisma/client";

export type WorkflowEntityType = "STANDING_SPEC" | "BATCH" | "AWS_DOCUMENT" | "COA_DOCUMENT";

export type WorkflowAction = "SUBMIT" | "APPROVE" | "SIGN" | "REJECT" | "SIGN_ISSUE";

export type WorkflowStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "QC_APPROVED"
  | "QA_SIGNED"
  | "SUPERSEDED"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "RELEASED"
  | "AUTO_GENERATED"
  | "ISSUED";

export type TransitionRule = {
  fromStatus: WorkflowStatus;
  action: WorkflowAction;
  toStatus: WorkflowStatus;
  requiredRole: Role;
};

export const STANDING_SPEC_TRANSITIONS: TransitionRule[] = [
  { fromStatus: "DRAFT", action: "SUBMIT", toStatus: "SUBMITTED", requiredRole: Role.QC_EXEC },
  { fromStatus: "SUBMITTED", action: "APPROVE", toStatus: "QC_APPROVED", requiredRole: Role.QC_MGR },
  { fromStatus: "SUBMITTED", action: "REJECT", toStatus: "DRAFT", requiredRole: Role.QC_MGR },
  { fromStatus: "QC_APPROVED", action: "SIGN", toStatus: "QA_SIGNED", requiredRole: Role.QA_MGR },
  { fromStatus: "QC_APPROVED", action: "REJECT", toStatus: "DRAFT", requiredRole: Role.QA_MGR },
];

export const BATCH_TRANSITIONS: TransitionRule[] = [
  { fromStatus: "DRAFT", action: "SUBMIT", toStatus: "PENDING_APPROVAL", requiredRole: Role.QC_MGR },
  { fromStatus: "PENDING_APPROVAL", action: "APPROVE", toStatus: "APPROVED", requiredRole: Role.QA_MGR },
  { fromStatus: "PENDING_APPROVAL", action: "REJECT", toStatus: "DRAFT", requiredRole: Role.QA_MGR },
];

export const AWS_DOCUMENT_TRANSITIONS: TransitionRule[] = [
  { fromStatus: "DRAFT", action: "SUBMIT", toStatus: "SUBMITTED", requiredRole: Role.QC_EXEC },
  { fromStatus: "SUBMITTED", action: "APPROVE", toStatus: "QC_APPROVED", requiredRole: Role.QC_MGR },
  { fromStatus: "SUBMITTED", action: "REJECT", toStatus: "DRAFT", requiredRole: Role.QC_MGR },
  { fromStatus: "QC_APPROVED", action: "SIGN", toStatus: "QA_SIGNED", requiredRole: Role.QA_MGR },
  { fromStatus: "QC_APPROVED", action: "REJECT", toStatus: "DRAFT", requiredRole: Role.QA_MGR },
];

/** US-13-7 / Dev Bible §5.3 — COA sign-and-issue releases batch. */
export const COA_DOCUMENT_TRANSITIONS: TransitionRule[] = [
  {
    fromStatus: "AUTO_GENERATED",
    action: "SIGN_ISSUE",
    toStatus: "ISSUED",
    requiredRole: Role.QA_MGR,
  },
];

const TRANSITIONS_BY_ENTITY: Record<WorkflowEntityType, TransitionRule[]> = {
  STANDING_SPEC: STANDING_SPEC_TRANSITIONS,
  BATCH: BATCH_TRANSITIONS,
  AWS_DOCUMENT: AWS_DOCUMENT_TRANSITIONS,
  COA_DOCUMENT: COA_DOCUMENT_TRANSITIONS,
};

export function findTransitionRule(
  entityType: WorkflowEntityType,
  fromStatus: WorkflowStatus,
  action: WorkflowAction,
): TransitionRule | undefined {
  return TRANSITIONS_BY_ENTITY[entityType].find(
    (rule) => rule.fromStatus === fromStatus && rule.action === action,
  );
}

/** @deprecated Use entity-specific lookup */
export const WORKFLOW_TRANSITIONS = STANDING_SPEC_TRANSITIONS;

export type WorkflowEntityMeta = {
  createdById: string | null;
  submittedById?: string | null;
  qcApprovedById?: string | null;
  assignedQcExecId?: string | null;
};

export function resolveWorkflowEntityType(docType: DocType): WorkflowEntityType | null {
  if (docType === DocType.AWS) return "AWS_DOCUMENT";
  if (docType === DocType.COA) return "COA_DOCUMENT";
  return null;
}
