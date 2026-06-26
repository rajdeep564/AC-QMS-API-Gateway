import { DocType } from "@prisma/client";
import { marketingBatchLink, marketingDocumentLink } from "./marketing.links";
import type {
  MarketingDocumentListRow,
  MarketingIssuedCoaRow,
  MarketingReleasedBatchRow,
} from "./marketing.repository";
import type {
  MarketingBatchDetailDto,
  MarketingCoaDetailDto,
  MarketingDocumentListItemDto,
} from "./marketing.types";

export function toMarketingDocumentListItem(
  doc: MarketingDocumentListRow,
): MarketingDocumentListItemDto {
  return {
    id: doc.id,
    docNo: doc.docNo,
    docType: doc.docType,
    productName: doc.batch.product.name,
    productCode: doc.batch.product.code,
    batchNo: doc.batch.batchNo,
    customerName: doc.batch.customerName,
    status: doc.status,
    releasedAt: doc.batch.releasedAt,
    link: marketingDocumentLink(doc.docType, doc.id, doc.batch.id),
  };
}

export function toMarketingCoaDetail(coa: MarketingIssuedCoaRow): MarketingCoaDetailDto {
  return {
    id: coa.id,
    docNo: coa.docNo,
    status: coa.status,
    complianceVerdict: coa.complianceVerdict,
    coaResults: coa.coaResults.map((row) => ({
      id: row.id,
      testName: row.testName,
      result: row.result,
      acceptanceLimits: row.acceptanceLimits,
      conclusion: row.conclusion,
      sortOrder: row.sortOrder,
    })),
    signatureLineage: {
      createdById: coa.createdById,
      createdByName: coa.createdBy?.fullName ?? null,
      qcApprovedById: coa.qcApprovedById,
      qcApprovedByName: coa.qcApprovedBy?.fullName ?? null,
      qaSignedById: coa.qaSignedById,
      qaSignedByName: coa.qaSignedBy?.fullName ?? null,
    },
    batchId: coa.batch.id,
    batchNo: coa.batch.batchNo,
    arn: coa.batch.arn,
    productName: coa.batch.product.name,
    productCode: coa.batch.product.code,
    customerName: coa.batch.customerName,
    customerRef: coa.batch.customerRef,
    mfgDateMonth: coa.batch.mfgDateMonth,
    mfgDateYear: coa.batch.mfgDateYear,
    expiryDate: coa.batch.expiryDate,
    releasedAt: coa.batch.releasedAt,
  };
}

export function toMarketingBatchDetail(batch: MarketingReleasedBatchRow): MarketingBatchDetailDto {
  const issuedCoaDoc = batch.batchDocuments.find((doc) => doc.docType === DocType.COA);

  return {
    id: batch.id,
    batchNo: batch.batchNo,
    arn: batch.arn,
    status: batch.status,
    productName: batch.product.name,
    productCode: batch.product.code,
    customerName: batch.customerName,
    customerRef: batch.customerRef,
    mfgDateMonth: batch.mfgDateMonth,
    mfgDateYear: batch.mfgDateYear,
    expiryDate: batch.expiryDate,
    releasedAt: batch.releasedAt,
    issuedCoa: issuedCoaDoc
      ? {
          id: issuedCoaDoc.id,
          docNo: issuedCoaDoc.docNo,
          complianceVerdict: issuedCoaDoc.complianceVerdict,
          link: marketingDocumentLink(DocType.COA, issuedCoaDoc.id, batch.id),
        }
      : null,
    documents: batch.batchDocuments.map((doc) => ({
      id: doc.id,
      docNo: doc.docNo,
      docType: doc.docType,
      status: doc.status,
      link: marketingDocumentLink(doc.docType, doc.id, batch.id),
    })),
  };
}
