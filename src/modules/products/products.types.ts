export interface ProductDto {
  id: string;
  name: string;
  createdAt: Date;
}

export interface ProductMasterSummaryDto {
  id: string;
  revisionNo: number;
  status: string;
  effectiveDate: Date | null;
  createdById: string;
  assignedToId: string | null;
  approvedById: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
