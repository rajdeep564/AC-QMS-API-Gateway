/**
 * Maps Prisma COA data → locked CoaRenderInput for DOC-Module POST /render.
 * Backend produces every display string; the renderer computes nothing.
 */

import { CoaComplianceVerdict, DocType, Role } from "@prisma/client";
import type { Db } from "../lib/prisma-types";
import { AppError } from "../lib/app-error";
import * as batchesRepo from "../modules/batches/batches.repository";
import * as mastersRepo from "../modules/masters/masters.repository";
import {
  formatComplianceRemark,
  formatDisplayDate,
  mapPersonSignature,
  type PersonSignatureDto,
} from "./render-formatters";

export type CoaResultRowDto = {
  sort_order: number;
  test_name: string;
  result: string;
  acceptance_limits: string | null;
  conclusion: string | null;
};

export type ProductIdentityDto = {
  product_name: string;
  product_code: string | null;
  reference: string | null;
  specification_no: string | null;
  moa_no: string | null;
};

export type BatchIdentityDto = {
  batch_no: string;
  arn_no: string | null;
  mfg_date: string | null;
  exp_date: string | null;
  batch_size: string | null;
  quantity_sampled?: null;
  test_request_no?: null;
  received_date?: null;
  testing_date?: null;
  completion_date?: null;
};

export type DocumentApprovalDto = {
  prepared_by: PersonSignatureDto;
  checked_by: PersonSignatureDto;
  approved_by: PersonSignatureDto;
};

export type CoaRenderInputDto = {
  document_no: string;
  document_no_label: string;
  document_type_label: string;
  revision_no: string;
  effective_date: string | null;
  review_date: string | null;
  company_name: string;
  product: ProductIdentityDto;
  batch: BatchIdentityDto;
  coa_results: CoaResultRowDto[];
  compliance_verdict: "COMPLIES" | "DOES_NOT_COMPLY";
  compliance_remark: string;
  approval: DocumentApprovalDto;
  revision_history: [];
};

function masterFieldValue(
  fields: { fieldKey: string; value: string | null }[] | undefined,
  key: string,
): string | null {
  const raw = fields?.find((f) => f.fieldKey === key)?.value;
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatRevisionNo(revisionNo: number | null | undefined): string {
  if (revisionNo === null || revisionNo === undefined) return "01";
  return String(revisionNo).padStart(2, "0");
}

function toDisplayDateOrNull(date: Date | null | undefined): string | null {
  const formatted = formatDisplayDate(date);
  return formatted.length > 0 ? formatted : null;
}

/**
 * Maps a COA batch_document to the locked CoaRenderInput contract.
 * document_no is read from stored batch_documents.doc_no — never recomputed.
 */
export async function mapToCoaRenderInput(
  coaDocId: string,
  client?: Db,
): Promise<CoaRenderInputDto> {
  const doc = await batchesRepo.findCoaDocumentForRender(coaDocId, client);
  if (!doc) {
    throw AppError.notFound("COA document");
  }
  if (doc.docType !== DocType.COA) {
    throw AppError.validation("Document is not a COA");
  }
  if (!doc.complianceVerdict) {
    throw AppError.conflict("COA compliance verdict is required before render");
  }

  const master = await mastersRepo.findActiveMasterForProduct(doc.batch.productId, client);
  if (!master) {
    throw AppError.conflict("ACTIVE Product Master is required for COA render");
  }
  const masterWithFields = await mastersRepo.findMasterWithFields(master.id, client);
  const fields = masterWithFields?.fields;

  const productCode = masterFieldValue(fields, "product_code");
  if (!productCode) {
    throw AppError.conflict("ACTIVE master is missing product_code field");
  }

  const productName =
    masterFieldValue(fields, "product_name") ?? doc.batch.product.name;
  const reference = masterFieldValue(fields, "product_grade");

  const spec = doc.batch.sourceSpec;
  const effectiveDate = toDisplayDateOrNull(spec.effectiveDate);

  // No per-stage timestamps on batch_documents; use createdAt as proxy for AWS-sign chain.
  const chainDate = toDisplayDateOrNull(doc.createdAt);
  const approvedDate = toDisplayDateOrNull(new Date());

  const batch: BatchIdentityDto = {
    batch_no: doc.batch.batchNo,
    arn_no: doc.batch.arnNo ?? null,
    mfg_date: toDisplayDateOrNull(doc.batch.mfgDate),
    exp_date: toDisplayDateOrNull(doc.batch.expDate),
    batch_size: doc.batch.batchSize ?? null,
  };

  return {
    document_no: doc.docNo,
    document_no_label: "COA NO.",
    document_type_label: "ANALYTICAL REPORT",
    revision_no: formatRevisionNo(spec.revisionNo),
    effective_date: effectiveDate,
    review_date: null,
    company_name: "Aditya Chemicals",
    product: {
      product_name: productName,
      product_code: productCode,
      reference,
      specification_no: spec.specNo,
      moa_no: spec.moaDoc?.moaNo ?? null,
    },
    batch,
    coa_results: doc.coaResults.map((row) => ({
      sort_order: row.sortOrder,
      test_name: row.testName,
      result: row.result,
      acceptance_limits: row.acceptanceLimits,
      conclusion: row.conclusion,
    })),
    compliance_verdict:
      doc.complianceVerdict === CoaComplianceVerdict.COMPLIES
        ? "COMPLIES"
        : "DOES_NOT_COMPLY",
    compliance_remark: formatComplianceRemark(doc.complianceVerdict),
    approval: {
      prepared_by: mapPersonSignature(
        doc.createdBy,
        doc.createdBy?.role ?? Role.QC_EXEC,
        chainDate,
      ),
      checked_by: mapPersonSignature(
        doc.qcApprovedBy,
        doc.qcApprovedBy?.role ?? Role.QC_MGR,
        chainDate,
      ),
      approved_by: mapPersonSignature(
        doc.qaSignedBy,
        doc.qaSignedBy?.role ?? Role.QA_MGR,
        approvedDate,
      ),
    },
    revision_history: [],
  };
}
