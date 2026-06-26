import { BatchStatus, DocPhase, DocStatus, DocType } from "@prisma/client";

export interface BatchDocumentDto {
  id: string;
  batchId: string;
  docType: DocType;
  docNo: string;
  status: DocStatus;
  sourceTemplateId: string | null;
  sourceMasterId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSummaryDto {
  id: string;
  fullName: string;
  username: string;
  role: string;
}

export interface ProductSummaryDto {
  id: string;
  name: string;
  code: string;
  shelfLifeMonths: number;
}

export interface TemplateSummaryDto {
  id: string;
  templateNo: string;
  variantType: string;
  status: string;
  sourceMasterId: string;
}

export interface MasterSummaryDto {
  id: string;
  revisionNo: number;
  status: string;
}

export interface BatchDto {
  id: string;
  productId: string;
  productMasterId: string;
  specTemplateId: string;
  batchNo: string;
  arn: string;
  mfgDateMonth: number;
  mfgDateYear: number;
  expiryDate: Date;
  batchSize: string | null;
  batchSizeUom: string | null;
  qtySampled: string | null;
  qtySampledUom: string | null;
  customerName: string | null;
  customerRef: string | null;
  customerSpecialInstructions: string | null;
  currentDocPhase: DocPhase;
  status: BatchStatus;
  assignedQcExecId: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BatchListItemDto extends BatchDto {
  product?: ProductSummaryDto;
  assignedQcExec?: UserSummaryDto | null;
}

export interface BatchDetailDto extends BatchDto {
  documents: BatchDocumentDto[];
  product: ProductSummaryDto;
  specTemplate: TemplateSummaryDto;
  productMaster: MasterSummaryDto;
  assignedQcExec: UserSummaryDto | null;
  workflowHistory: unknown[];
}

export interface CreateBatchResultDto {
  batch: BatchDto;
  documents: BatchDocumentDto[];
}
