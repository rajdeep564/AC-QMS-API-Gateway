import { Conclusion, Operator, ResultType, SectionStatus } from "@prisma/client";

export type ResolvedLimitsDto = {
  specDocumentTestId: string;
  resultType: ResultType;
  acceptanceCriteria: string | null;
  minValue: string | null;
  maxValue: string | null;
  operator: Operator | null;
  uom: string | null;
};

export type FormulaConfigDto = {
  formula: string | null;
};

export type SectionFieldConfigDto = {
  layout: "IN_HOUSE" | "OUTSIDE_LAB";
  showInstrument: boolean;
  showReagent: boolean;
  showFormulaInputs: boolean;
  showQualitativePassFail: boolean;
  showFileUpload: boolean;
  requiresAttachment: boolean;
};

export type AwsAttachmentDto = {
  id: string;
  fileName: string;
  mimeType: string;
  createdAt: string;
};

export type UserRefDto = {
  id: string;
  fullName: string;
} | null;

export type AwsSectionListItemDto = {
  id: string;
  batchDocumentId: string;
  specDocumentTestId: string;
  sortOrder: number;
  status: SectionStatus;
  testName: string;
  resultType: ResultType;
  limits: ResolvedLimitsDto;
  readings: unknown;
  calculatedResult: string | null;
  resultDisplay: string | null;
  conclusion: Conclusion | null;
  isOos: boolean;
  oosAcknowledged: boolean;
  oosAckComment: string | null;
  instrumentId: string | null;
  instrumentExpired: boolean;
  instrumentExpiredAck: boolean;
  instrumentExpiredAckComment: string | null;
  reagentId: string | null;
  reagentExpired: boolean;
  reagentExpiredAck: boolean;
  reagentExpiredAckComment: string | null;
  analystId: string | null;
  analyst: UserRefDto;
  checkerId: string | null;
  checker: UserRefDto;
  /** Advisory UI hints — enforcement remains in aws-guards (Epic 12 / US-12-x). */
  allowedActions: string[];
  sectionFieldConfig: SectionFieldConfigDto;
  procedureSnapshot: string | null;
  attachmentCount: number;
};

export type AwsSectionDetailDto = AwsSectionListItemDto & {
  formula: FormulaConfigDto;
  batchId: string;
  awsDocNo: string;
  awsDocStatus: string;
  assignedQcExecId: string | null;
};

export type AwsSectionStatusSummary = {
  NOT_STARTED: number;
  IN_PROGRESS: number;
  AWAITING_CHECK: number;
  COMPLETE: number;
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
  isOos: boolean;
};

export type AwsSectionPatchResultDto = AwsSectionDetailDto;
