import { Operator, ResultType, SpecVariant, StandingDocStatus } from "@prisma/client";
import { WorkflowAction } from "../../services/workflow.config";

export type SpecTestDto = {
  id: string;
  sortOrder: number;
  testName: string;
  resultType: ResultType;
  operator: Operator | null;
  minValue: string | null;
  maxValue: string | null;
  uom: string | null;
  acceptanceCriteria: string | null;
  formula: string | null;
  formulaVariables: unknown;
  isOptional: boolean;
  isOutsideLab: boolean;
};

export type MoaSectionDto = {
  id: string;
  specTestId: string;
  pharmacopoeia: string | null;
  samplePreparation: string | null;
  standardPreparation: string | null;
  blankPreparation: string | null;
  reagentPreparation: string | null;
  instrumentParameters: string | null;
  systemSuitability: string | null;
  sequenceTable: string | null;
  procedureText: string | null;
  formulaReference: string | null;
  conclusionTemplate: string | null;
  additionalNotes: string | null;
};

export type MoaDocDto = {
  id: string;
  moaNo: string;
  revisionNo: number;
  status: StandingDocStatus;
  sections: MoaSectionDto[];
};

export type SpecListItemDto = {
  id: string;
  productId: string;
  variant: SpecVariant;
  specNo: string;
  revisionNo: number;
  status: StandingDocStatus;
  createdById: string;
  approvedAt: Date | null;
  effectiveDate: Date | null;
  createdAt: Date;
  hasMoa: boolean;
};

export type SpecApprovalQueueSubmitterDto = {
  username: string;
  fullName: string;
};

export type SpecApprovalQueueItemDto = {
  id: string;
  specNo: string;
  moaNo: string | null;
  revisionNo: number;
  productId: string;
  productName: string;
  status: StandingDocStatus;
  submittedBy: SpecApprovalQueueSubmitterDto | null;
  submittedAt: Date;
};

export type SpecSignatureQueueItemDto = {
  id: string;
  specNo: string;
  moaNo: string | null;
  revisionNo: number;
  productId: string;
  productName: string;
  status: StandingDocStatus;
  qcApprovedBy: SpecApprovalQueueSubmitterDto | null;
  approvedAt: Date;
};

export type SpecDetailDto = {
  id: string;
  productId: string;
  variant: SpecVariant;
  specNo: string;
  revisionNo: number;
  status: StandingDocStatus;
  supersedesId: string | null;
  createdById: string;
  submittedById: string | null;
  qcApprovedById: string | null;
  qaSignedById: string | null;
  approvedAt: Date | null;
  effectiveDate: Date | null;
  createdAt: Date;
  tests: SpecTestDto[];
  moa: MoaDocDto | null;
  allowedActions: WorkflowAction[];
};
