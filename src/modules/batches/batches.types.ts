import { BatchStatus, DocStatus, DocType, RenderStatus } from "@prisma/client";

export interface BatchDocumentDto {
  id: string;
  docType: DocType;
  docNo: string;
  status: DocStatus;
  complianceVerdict: string | null;
  renderStatus: RenderStatus;
  renderError: string | null;
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
  isOutsideLab: boolean;
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
  signatureLineage: import("../../utils/signature-lineage.mapper").SignatureLineageDto;
}

export interface CreateBatchResultDto {
  batch: BatchDetailDto;
}

export interface BatchReadyProductDto {
  productId: string;
  productName: string;
  sourceSpecId: string;
  specNo: string;
  revisionNo: number;
  shelfLifeMonths: number;
}
