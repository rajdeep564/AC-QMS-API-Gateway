import { BatchStatus, DocStatus, DocType } from "@prisma/client";

export interface BatchDocumentDto {
  id: string;
  docType: DocType;
  docNo: string;
  status: DocStatus;
  complianceVerdict: string | null;
}

export interface SpecDocumentTestDto {
  id: string;
  sourceSpecTestId: string | null;
  testName: string;
  resultType: string;
  operator: string | null;
  minValue: string | null;
  maxValue: string | null;
  uom: string | null;
  acceptanceCriteria: string | null;
  formula: string | null;
  sortOrder: number;
}

export interface MoaDocumentSectionDto {
  id: string;
  sourceMoaSectionId: string | null;
  specDocumentTestId: string;
  procedureSnapshot: string | null;
}

export interface UserSummaryDto {
  id: string;
  fullName: string;
  username?: string;
}

export interface ProductSummaryDto {
  id: string;
  name: string;
}

export interface BatchDto {
  id: string;
  productId: string;
  sourceSpecId: string;
  batchNo: string;
  arnNo: string | null;
  status: BatchStatus;
  mfgDate: Date | null;
  expDate: Date | null;
  batchSize: string | null;
  assignedQcExecId: string | null;
  createdById: string;
  approvedById: string | null;
  createdAt: Date;
  releasedAt: Date | null;
}

export interface BatchListItemDto extends BatchDto {
  product?: ProductSummaryDto;
  assignedQcExec?: UserSummaryDto | null;
  batchDocuments?: BatchDocumentDto[];
}

export interface BatchDetailDto extends BatchDto {
  product: ProductSummaryDto;
  sourceSpec: { id: string; specNo: string; revisionNo: number; status: string };
  assignedQcExec: UserSummaryDto | null;
  createdBy: UserSummaryDto;
  approvedBy: UserSummaryDto | null;
  specDocTests: SpecDocumentTestDto[];
  moaDocSections: MoaDocumentSectionDto[];
  batchDocuments: BatchDocumentDto[];
  allowedActions: string[];
}

export interface CreateBatchResultDto {
  batch: BatchDetailDto;
}
