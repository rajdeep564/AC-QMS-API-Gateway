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
    batchNo: doc.batch.batchNo,
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
    arnNo: coa.batch.arnNo,
    productName: coa.batch.product.name,
    mfgDate: coa.batch.mfgDate,
    expDate: coa.batch.expDate,
    releasedAt: coa.batch.releasedAt,
  };
}

export function toMarketingBatchDetail(batch: MarketingReleasedBatchRow): MarketingBatchDetailDto {
  const issuedCoaDoc = batch.batchDocuments.find((doc) => doc.docType === DocType.COA);

  return {
    id: batch.id,
    batchNo: batch.batchNo,
    arnNo: batch.arnNo,
    status: batch.status,
    productName: batch.product.name,
    mfgDate: batch.mfgDate,
    expDate: batch.expDate,
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
