import { CoaComplianceVerdict, DocStatus, DocType } from "@prisma/client";

export type MarketingCoaResultDto = {
  id: string;
  testName: string;
  result: string;
  acceptanceLimits: string;
  conclusion: string;
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
  productCode: string;
  batchNo: string;
  customerName: string | null;
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
  arn: string;
  productName: string;
  productCode: string;
  customerName: string | null;
  customerRef: string | null;
  mfgDateMonth: number;
  mfgDateYear: number;
  expiryDate: Date;
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
  arn: string;
  status: string;
  productName: string;
  productCode: string;
  customerName: string | null;
  customerRef: string | null;
  mfgDateMonth: number;
  mfgDateYear: number;
  expiryDate: Date;
  releasedAt: Date | null;
  issuedCoa: MarketingIssuedCoaSummaryDto | null;
  documents: MarketingBatchDocumentSummaryDto[];
};
