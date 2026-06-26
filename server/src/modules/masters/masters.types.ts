import { MasterStatus, Operator, ResultType } from "@prisma/client";
import { WorkflowAction } from "../../services/workflow.config";

export interface TestParameterDto {
  id: string;
  sortOrder: number;
  testName: string;
  isMandatory: boolean;
  resultType: ResultType;
  acceptanceCriteria: string | null;
  minValue: string | null;
  maxValue: string | null;
  operator: Operator | null;
  uom: string | null;
  departmentId: string | null;
  isOutsideLab: boolean;
  calculationFormula: string | null;
  formulaVariables: unknown;
  instrumentsRequired: string[];
  reagentsRequired: string[];
}

export interface MoaSectionDto {
  id: string;
  testParameterId: string;
  pharmacopoeia: string | null;
  samplePreparation: string | null;
  standardPreparation: string | null;
  blankPreparation: string | null;
  conclusionTemplate: string | null;
  additionalNotes: string | null;
}

export interface MasterDetailDto {
  id: string;
  productId: string;
  revisionNo: number;
  status: MasterStatus;
  effectiveDate: Date | null;
  createdById: string;
  submittedById: string | null;
  submittedAt: Date | null;
  qcApprovedById: string | null;
  qcApprovedAt: Date | null;
  qaSignedById: string | null;
  qaSignedAt: Date | null;
  rejectionComment: string | null;
  createdAt: Date;
  updatedAt: Date;
  testParameters: TestParameterDto[];
  moaSections: MoaSectionDto[];
  allowedActions: WorkflowAction[];
}
