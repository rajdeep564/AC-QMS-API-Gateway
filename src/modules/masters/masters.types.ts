import { FieldDataType, MasterStatus } from "@prisma/client";
import { MasterAction } from "../../services/master-workflow.service";

export interface MasterFieldDto {
  id: string;
  fieldKey: string;
  label: string;
  value: string | null;
  dataType: FieldDataType;
  sortOrder: number;
  isRequired: boolean;
}

export interface MasterDetailDto {
  id: string;
  productId: string;
  revisionNo: number;
  status: MasterStatus;
  effectiveDate: Date | null;
  supersedesId: string | null;
  createdById: string;
  assignedToId: string | null;
  approvedById: string | null;
  approvedAt: Date | null;
  rejectionComment: string | null;
  importedFrom: string | null;
  createdAt: Date;
  updatedAt: Date;
  fields: MasterFieldDto[];
  allowedActions: MasterAction[];
}

export interface MasterSummaryDto {
  id: string;
  productId: string;
  revisionNo: number;
  status: MasterStatus;
  effectiveDate: Date | null;
  createdById: string;
  assignedToId: string | null;
  approvedById: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
