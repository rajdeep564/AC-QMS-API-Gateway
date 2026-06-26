import { DocType, MasterStatus, Role } from "@prisma/client";

export type WorkflowEntityType =
  | "PRODUCT_MASTER"
  | "SPEC_TEMPLATE"
  | "SPEC_DOCUMENT"
  | "MOA_DOCUMENT"
  | "AWS_DOCUMENT";

export type WorkflowAction = "SUBMIT" | "APPROVE" | "SIGN" | "REJECT";

export type WorkflowStatus =
  | "PENDING"
  | "DRAFT"
  | "SUBMITTED"
  | "QC_APPROVED"
  | "QA_SIGNED"
  | "SUPERSEDED";

export type TransitionRule = {
  fromStatus: WorkflowStatus;
  action: WorkflowAction;
  toStatus: WorkflowStatus;
  requiredRole: Role;
};

export type AuthoringTransitionRule = {
  fromStatus: WorkflowStatus;
  toStatus: WorkflowStatus;
  requiredRole: Role;
};

export const WORKFLOW_TRANSITIONS: TransitionRule[] = [
  { fromStatus: "DRAFT", action: "SUBMIT", toStatus: "SUBMITTED", requiredRole: Role.QC_EXEC },
  { fromStatus: "SUBMITTED", action: "APPROVE", toStatus: "QC_APPROVED", requiredRole: Role.QC_MGR },
  { fromStatus: "SUBMITTED", action: "REJECT", toStatus: "DRAFT", requiredRole: Role.QC_MGR },
  { fromStatus: "QC_APPROVED", action: "SIGN", toStatus: "QA_SIGNED", requiredRole: Role.QA_MGR },
  { fromStatus: "QC_APPROVED", action: "REJECT", toStatus: "DRAFT", requiredRole: Role.QA_MGR },
];

export const AUTHORING_TRANSITIONS: AuthoringTransitionRule[] = [
  { fromStatus: "PENDING", toStatus: "DRAFT", requiredRole: Role.QC_EXEC },
];

/** @deprecated Use WORKFLOW_TRANSITIONS */
export const PRODUCT_MASTER_TRANSITIONS = WORKFLOW_TRANSITIONS;

export function findTransitionRule(
  fromStatus: WorkflowStatus,
  action: WorkflowAction,
): TransitionRule | undefined {
  return WORKFLOW_TRANSITIONS.find(
    (rule) => rule.fromStatus === fromStatus && rule.action === action,
  );
}

export function findAuthoringTransitionRule(
  fromStatus: WorkflowStatus,
  toStatus: WorkflowStatus,
): AuthoringTransitionRule | undefined {
  return AUTHORING_TRANSITIONS.find(
    (rule) => rule.fromStatus === fromStatus && rule.toStatus === toStatus,
  );
}

export function resolveWorkflowEntityType(docType: DocType): WorkflowEntityType | null {
  switch (docType) {
    case DocType.SPEC:
      return "SPEC_DOCUMENT";
    case DocType.MOA:
      return "MOA_DOCUMENT";
    case DocType.AWS:
      return "AWS_DOCUMENT";
    default:
      return null;
  }
}

export type WorkflowEntityMeta = {
  createdById: string | null;
  submittedById: string | null;
  qcApprovedById: string | null;
  assignedQcExecId?: string | null;
};

/** @deprecated Use WorkflowEntityMeta */
export type MasterEntityMeta = WorkflowEntityMeta;
