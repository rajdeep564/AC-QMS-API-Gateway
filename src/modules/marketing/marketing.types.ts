import { CoaComplianceVerdict, DocStatus, DocType } from "@prisma/client";

export type MarketingCoaResultDto = {
  id: string;
  testName: string;
  result: string;
  acceptanceLimits: string | null;
  conclusion: string | null;
  sortOrder: number;
};

export type MarketingSignatureLineageDto = {
  createdById: string | null;
  createdByName: string | null;
  qcApprovedById: string | null;
  qcApprovedByName: string | null;
  qaSignedById: string | null;
  qaSignedByName: string | null;
};

export type MarketingDocumentListItemDto = {
  id: string;
  docNo: string;
  docType: DocType;
  productName: string;
  batchNo: string;
  status: DocStatus;
  releasedAt: Date | null;
  link: string;
};

export type MarketingCoaDetailDto = {
  id: string;
  docNo: string;
  status: DocStatus;
  complianceVerdict: CoaComplianceVerdict | null;
  coaResults: MarketingCoaResultDto[];
  signatureLineage: MarketingSignatureLineageDto;
  batchId: string;
  batchNo: string;
  arnNo: string | null;
  productName: string;
  mfgDate: Date | null;
  expDate: Date | null;
  releasedAt: Date | null;
};

export type MarketingBatchDocumentSummaryDto = {
  id: string;
  docNo: string;
  docType: DocType;
  status: DocStatus;
  link: string;
};

export type MarketingIssuedCoaSummaryDto = {
  id: string;
  docNo: string;
  complianceVerdict: CoaComplianceVerdict | null;
  link: string;
};

export type MarketingBatchDetailDto = {
  id: string;
  batchNo: string;
  arnNo: string | null;
  status: string;
  productName: string;
  mfgDate: Date | null;
  expDate: Date | null;
  releasedAt: Date | null;
  issuedCoa: MarketingIssuedCoaSummaryDto | null;
  documents: MarketingBatchDocumentSummaryDto[];
};
