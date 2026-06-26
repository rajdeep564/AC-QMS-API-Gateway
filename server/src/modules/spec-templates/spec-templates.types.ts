import { TemplateStatus, VariantType } from "@prisma/client";
import { WorkflowAction } from "../../services/workflow.config";

export interface SpecTemplateTestDto {
  id: string;
  testParameterId: string;
  sortOrder: number;
  isIncluded: boolean;
  isOptional: boolean;
  overrideMinValue: string | null;
  overrideMaxValue: string | null;
  overrideAcceptance: string | null;
  testParameter: {
    id: string;
    testName: string;
    resultType: string;
    isMandatory: boolean;
  };
}

export interface SpecTemplateListItemDto {
  id: string;
  templateNo: string;
  variantType: VariantType;
  customerName: string | null;
  revisionNo: number;
  status: TemplateStatus;
  sourceMasterId: string;
  copiedFromTemplateId: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpecTemplateDetailDto {
  id: string;
  productId: string;
  sourceMasterId: string;
  templateNo: string;
  variantType: VariantType;
  customerName: string | null;
  copiedFromTemplateId: string | null;
  revisionNo: number;
  status: TemplateStatus;
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
  tests: SpecTemplateTestDto[];
  allowedActions: WorkflowAction[];
}
