import { DocType, Role } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import type { Db } from "../../lib/prisma-types";
import * as batchesRepo from "../../modules/batches/batches.repository";
import * as mastersRepo from "../../modules/masters/masters.repository";
import type { AwsRenderInputDto } from "../sop-client/types";
import {
  formatAcceptanceLimits,
  formatConclusionLabel,
  formatDisplayDate,
  formatInstrumentDisplay,
  formatReadingsDisplay,
  formatReagentDisplay,
  formatSectionResult,
  mapPersonSignature,
  projectSectionNo,
} from "../render-formatters";
import {
  hasInstrumentExpiryAck,
  hasReagentExpiryAck,
  parseReadings,
  type AwsReadings,
} from "../aws-expiry.service";

function masterFieldValue(
  fields: { fieldKey: string; value: string | null }[] | undefined,
  key: string,
): string | null {
  const raw = fields?.find((f) => f.fieldKey === key)?.value;
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toDisplayDateOrNull(date: Date | null | undefined): string | null {
  const formatted = formatDisplayDate(date);
  return formatted.length > 0 ? formatted : null;
}

function formatRevisionNo(revisionNo: number | null | undefined): string {
  if (revisionNo === null || revisionNo === undefined) return "01";
  return String(revisionNo).padStart(2, "0");
}

function parseProcedureSnapshot(snapshot: string | null | undefined): string | null {
  if (!snapshot?.trim()) return null;
  try {
    const parsed = JSON.parse(snapshot) as Record<string, string | null>;
    const parts = [
      parsed.pharmacopoeia && `Pharmacopoeia: ${parsed.pharmacopoeia}`,
      parsed.samplePreparation && `Sample prep: ${parsed.samplePreparation}`,
      parsed.standardPreparation && `Standard prep: ${parsed.standardPreparation}`,
      parsed.blankPreparation && `Blank prep: ${parsed.blankPreparation}`,
      parsed.conclusionTemplate && `Conclusion: ${parsed.conclusionTemplate}`,
      parsed.additionalNotes,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join("\n\n") : snapshot;
  } catch {
    return snapshot;
  }
}

/**
 * Maps AWS batch_document → AwsRenderInput for DOC-Module POST /render.
 * Pure mapping from an already-loaded document graph.
 */
export async function mapAwsToRenderInput(
  awsDocId: string,
  client?: Db,
): Promise<AwsRenderInputDto> {
  const doc = await batchesRepo.findAwsDocumentForRender(awsDocId, client);
  if (!doc) {
    throw AppError.notFound("AWS document");
  }
  if (doc.docType !== DocType.AWS) {
    throw AppError.validation("Document is not an AWS");
  }

  const master = await mastersRepo.findActiveMasterForProduct(doc.batch.productId, client);
  if (!master) {
    throw AppError.conflict("ACTIVE Product Master is required for AWS render");
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

  const procedureByTestId = new Map(
    doc.batch.moaDocSections.map((s) => [s.specDocumentTestId, s.procedureSnapshot]),
  );

  const chainDate = toDisplayDateOrNull(doc.createdAt);

  const sections = doc.awsSections.map((section) => {
    const test = section.specDocumentTest;
    const readings = parseReadings(section.readings) as AwsReadings & {
      instrumentExpiredAckComment?: string;
      reagentExpiredAckComment?: string;
    };
    const expiryAckComment =
      readings.instrumentExpiredAckComment?.trim() ||
      readings.reagentExpiredAckComment?.trim() ||
      null;
    return {
      sort_order: test.sortOrder,
      section_no: projectSectionNo(test.sortOrder),
      test_name: test.testName,
      limits_display: formatAcceptanceLimits(test),
      procedure_text: parseProcedureSnapshot(procedureByTestId.get(test.id) ?? null),
      readings_display: formatReadingsDisplay(section.readings, test.resultType) || null,
      calculated_result: section.calculatedResult?.toString() ?? null,
      result_display: formatSectionResult(
        test.resultType,
        section.resultDisplay,
        section.readings,
      ),
      conclusion_display: formatConclusionLabel(section.conclusion),
      is_oos: section.isOos,
      oos_acknowledged: section.oosAcknowledged,
      oos_ack_comment: section.oosAckComment,
      instrument_display: formatInstrumentDisplay(
        section.instrument
          ? {
              instrumentId: section.instrument.instrumentId,
              name: section.instrument.name,
              calibrationDate: section.instrument.calibrationDate,
              useBefore: section.instrument.useBefore,
            }
          : null,
      ) || null,
      reagent_display: formatReagentDisplay(
        section.reagent
          ? {
              name: section.reagent.name,
              lotNo: section.reagent.lotNo,
              expiryDate: section.reagent.expiryDate,
            }
          : null,
      ) || null,
      instrument_expired_ack: hasInstrumentExpiryAck(readings),
      reagent_expired_ack: hasReagentExpiryAck(readings),
      expiry_ack_comment: expiryAckComment,
      analyst: mapPersonSignature(
        section.analyst,
        section.analyst?.role ?? Role.QC_EXEC,
        chainDate,
      ),
      checker: mapPersonSignature(
        section.checker,
        section.checker?.role ?? Role.QC_EXEC,
        chainDate,
      ),
    };
  });

  return {
    document_no: doc.docNo,
    document_no_label: "AWS NO.",
    document_type_label: "FINISHED PRODUCT ANALYSIS PROTOCOL",
    revision_no: formatRevisionNo(spec.revisionNo),
    effective_date: toDisplayDateOrNull(spec.effectiveDate),
    review_date: null,
    company_name: "Aditya Chemicals",
    department: "QUALITY ASSURANCE",
    product: {
      product_name: productName,
      product_code: productCode,
      reference,
      specification_no: spec.specNo,
      moa_no: spec.moaDoc?.moaNo ?? null,
    },
    batch: {
      batch_no: doc.batch.batchNo,
      arn_no: doc.batch.arnNo ?? null,
      mfg_date: toDisplayDateOrNull(doc.batch.mfgDate),
      exp_date: toDisplayDateOrNull(doc.batch.expDate),
      batch_size: doc.batch.batchSize ?? null,
    },
    sections,
    approval: {
      prepared_by: mapPersonSignature(
        doc.createdBy ?? doc.batch.assignedQcExec,
        (doc.createdBy ?? doc.batch.assignedQcExec)?.role ?? Role.QC_EXEC,
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
        toDisplayDateOrNull(new Date()) ?? chainDate,
      ),
    },
    revision_history: [],
  };
}
