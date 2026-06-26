import { WorkflowAction, WorkflowStatus } from "../../services/workflow.config";

export type DocumentAllowedAction = WorkflowAction | "SIGN_AND_ISSUE";

export type DocumentStatus = WorkflowStatus | "AUTO_GENERATED" | "ISSUED";

export type CoaResultDto = {
  id: string;
  testName: string;
  result: string;
  acceptanceLimits: string;
  conclusion: string;
  sortOrder: number;
};

export type SpecDocumentTestDto = {
  id: string;
  testParameterId: string;
  sortOrder: number;
  testName: string;
  isMandatory: boolean;
  isOptionalActivated: boolean;
  resultType: string;
  acceptanceCriteria: string | null;
  minValue: string | null;
  maxValue: string | null;
  operator: string | null;
  uom: string | null;
  departmentId: string | null;
};

export type MoaDocumentSectionDto = {
  id: string;
  testParameterId: string;
  sortOrder: number;
  testName: string;
  pharmacopoeia: string | null;
  samplePreparation: string | null;
  standardPreparation: string | null;
  blankPreparation: string | null;
  conclusionTemplate: string | null;
  additionalNotes: string | null;
};

export type DocumentDetailDto = {
  id: string;
  batchId: string;
  docType: string;
  docNo: string;
  status: DocumentStatus;
  sourceTemplateId: string | null;
  sourceMasterId: string | null;
  optionalTestsActivated: string[];
  complianceVerdict: string | null;
  createdById: string | null;
  submittedById: string | null;
  submittedAt: Date | null;
  qcApprovedById: string | null;
  qcApprovedAt: Date | null;
  qaSignedById: string | null;
  qaSignedAt: Date | null;
  rejectionComment: string | null;
  createdAt: Date;
  updatedAt: Date;
  tests: SpecDocumentTestDto[];
  sections: MoaDocumentSectionDto[];
  coaResults: CoaResultDto[];
  allowedActions: DocumentAllowedAction[];
};
