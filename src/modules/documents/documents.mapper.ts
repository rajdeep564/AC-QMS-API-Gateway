import { DocType } from "@prisma/client";
import {
  buildSignatureLineage,
  SignatureLineageDto,
} from "../../utils/signature-lineage.mapper";
import { StageTimestamps } from "../../utils/signature-lineage-audit";
import { DocumentDetail } from "./documents.repository";
import { CoaResultDto, DocumentAllowedAction, DocumentDetailDto } from "./documents.types";

function toCoaResult(row: DocumentDetail["coaResults"][number]): CoaResultDto {
  return {
    testName: row.testName,
    result: row.result,
    acceptanceLimits: row.acceptanceLimits,
    conclusion: row.conclusion,
    sortOrder: row.sortOrder,
  };
}

export function toDocumentDetail(
  doc: DocumentDetail,
  allowedActions: DocumentAllowedAction[],
  stageTimestamps?: StageTimestamps,
): DocumentDetailDto {
  const signatureLineage: SignatureLineageDto = buildSignatureLineage({
    authoredBy: doc.createdBy,
    authoredAt: doc.createdAt,
    submittedBy: doc.submittedBy,
    submittedAt: stageTimestamps?.submittedAt ?? null,
    qcApprovedBy: doc.qcApprovedBy,
    qcApprovedAt: stageTimestamps?.qcApprovedAt ?? null,
    qaSignedBy: doc.qaSignedBy,
    qaSignedAt: stageTimestamps?.qaSignedAt ?? null,
  });

  return {
    id: doc.id,
    batchId: doc.batchId,
    docType: doc.docType,
    docNo: doc.docNo,
    status: doc.status,
    complianceVerdict: doc.complianceVerdict,
    createdById: doc.createdById,
    submittedById: doc.submittedById,
    qcApprovedById: doc.qcApprovedById,
    qaSignedById: doc.qaSignedById,
    batch: {
      id: doc.batch.id,
      batchNo: doc.batch.batchNo,
      arnNo: doc.batch.arnNo,
      status: doc.batch.status,
      assignedQcExecId: doc.batch.assignedQcExecId,
    },
    coaResults: doc.docType === DocType.COA ? doc.coaResults.map(toCoaResult) : [],
    allowedActions: allowedActions,
    signatureLineage,
  };
}
