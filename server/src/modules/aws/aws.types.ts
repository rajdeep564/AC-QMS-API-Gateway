import { Conclusion, Operator, ResultType, SectionStatus } from "@prisma/client";
import { WorkflowAction } from "../../services/workflow.config";

export type ResolvedLimitsDto = {
  specDocumentTestId: string | null;
  resultType: ResultType;
  acceptanceCriteria: string | null;
  minValue: string | null;
  maxValue: string | null;
  operator: Operator | null;
  uom: string | null;
};

export type FormulaConfigDto = {
  calculationFormula: string | null;
  variables: import("../../services/formula-engine").FormulaVariableDef[];
  steps?: import("../../services/formula-engine").FormulaStepDef[];
};

export type UserRefDto = {
  id: string;
  fullName: string;
} | null;

export type AwsSectionListItemDto = {
  id: string;
  batchDocumentId: string;
  testParameterId: string;
  specDocumentTestId: string | null;
  sortOrder: number;
  status: SectionStatus;
  testName: string;
  resultType: ResultType;
  limits: ResolvedLimitsDto;
  observations: unknown;
  calculatedResult: string | null;
  resultDisplay: string | null;
  conclusion: Conclusion | null;
  oosDetected: boolean;
  oosAcknowledged: boolean;
  oosAcknowledgedAt: string | null;
  instrumentId: string | null;
  instrumentExpired: boolean;
  instrumentExpiredAck: boolean;
  reagentsUsed: unknown;
  reagentExpired: boolean;
  remarks: string | null;
  analyzedById: string | null;
  analyzedBy: UserRefDto;
  checkedById: string | null;
  checkedBy: UserRefDto;
  completedAt: string | null;
};

export type AwsSectionDetailDto = AwsSectionListItemDto & {
  formula: FormulaConfigDto;
  batchId: string;
  awsDocNo: string;
  awsDocStatus: string;
  assignedQcExecId: string | null;
  allowedActions: WorkflowAction[];
};

export type AwsSectionStatusSummary = {
  NOT_STARTED: number;
  IN_PROGRESS: number;
  AWAITING_CHECK: number;
  COMPLETED: number;
};

export type AwsSectionsListResponseDto = {
  sections: AwsSectionListItemDto[];
  allSectionsComplete: boolean;
  sectionStatusSummary: AwsSectionStatusSummary;
};

export type AwsSectionPreviewDto = {
  calculatedResult: string | null;
  resultDisplay: string | null;
  conclusion: Conclusion | null;
  oosDetected: boolean;
};

export type AwsSectionPatchResultDto = AwsSectionDetailDto;
