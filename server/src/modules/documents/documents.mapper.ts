import { DocStatus, DocType, Prisma, Role } from "@prisma/client";
import { getAllowedActions } from "../../services/workflow-engine";
import { resolveWorkflowEntityType, WorkflowStatus } from "../../services/workflow.config";
import {
  CoaResultDto,
  DocumentAllowedAction,
  DocumentDetailDto,
  DocumentStatus,
  MoaDocumentSectionDto,
  SpecDocumentTestDto,
} from "./documents.types";

export function toSpecTestDto(
  test: Prisma.SpecDocumentTestGetPayload<object>,
): SpecDocumentTestDto {
  return {
    id: test.id,
    testParameterId: test.testParameterId,
    sortOrder: test.sortOrder,
    testName: test.testName,
    isMandatory: test.isMandatory,
    isOptionalActivated: test.isOptionalActivated,
    resultType: test.resultType,
    acceptanceCriteria: test.acceptanceCriteria,
    minValue: test.minValue?.toString() ?? null,
    maxValue: test.maxValue?.toString() ?? null,
    operator: test.operator,
    uom: test.uom,
    departmentId: test.departmentId,
  };
}

export function toMoaSectionDto(
  section: Prisma.MoaDocumentSectionGetPayload<object>,
): MoaDocumentSectionDto {
  return {
    id: section.id,
    testParameterId: section.testParameterId,
    sortOrder: section.sortOrder,
    testName: section.testName,
    pharmacopoeia: section.pharmacopoeia,
    samplePreparation: section.samplePreparation,
    standardPreparation: section.standardPreparation,
    blankPreparation: section.blankPreparation,
    conclusionTemplate: section.conclusionTemplate,
    additionalNotes: section.additionalNotes,
  };
}

export function toCoaResultDto(result: Prisma.CoaResultGetPayload<object>): CoaResultDto {
  return {
    id: result.id,
    testName: result.testName,
    result: result.result,
    acceptanceLimits: result.acceptanceLimits,
    conclusion: result.conclusion,
    sortOrder: result.sortOrder,
  };
}

export function resolveCoaAllowedActions(
  status: DocStatus,
  role: Role,
): DocumentAllowedAction[] {
  if (status === DocStatus.AUTO_GENERATED && role === Role.QA_MGR) {
    return ["SIGN_AND_ISSUE"];
  }
  return [];
}

export function toDocumentDetail(
  doc: Prisma.BatchDocumentGetPayload<{
    include: {
      specDocumentTests: true;
      moaDocumentSections: true;
      coaResults: true;
      batch: { select: { assignedQcExecId: true } };
    };
  }>,
  allowedActions: DocumentAllowedAction[],
): DocumentDetailDto {
  return {
    id: doc.id,
    batchId: doc.batchId,
    docType: doc.docType,
    docNo: doc.docNo,
    status: doc.status as DocumentStatus,
    sourceTemplateId: doc.sourceTemplateId,
    sourceMasterId: doc.sourceMasterId,
    optionalTestsActivated: doc.optionalTestsActivated,
    complianceVerdict: doc.complianceVerdict,
    createdById: doc.createdById,
    submittedById: doc.submittedById,
    submittedAt: doc.submittedAt,
    qcApprovedById: doc.qcApprovedById,
    qcApprovedAt: doc.qcApprovedAt,
    qaSignedById: doc.qaSignedById,
    qaSignedAt: doc.qaSignedAt,
    rejectionComment: doc.rejectionComment,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    tests:
      doc.docType === DocType.SPEC
        ? doc.specDocumentTests
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(toSpecTestDto)
        : [],
    sections:
      doc.docType === DocType.MOA
        ? doc.moaDocumentSections
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(toMoaSectionDto)
        : [],
    coaResults:
      doc.docType === DocType.COA
        ? doc.coaResults
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(toCoaResultDto)
        : [],
    allowedActions,
  };
}

export function resolveDocumentAllowedActions(
  doc: {
    docType: DocType;
    status: DocStatus;
  },
  role: Role,
  actorUserId: string,
  entityMeta: {
    createdById: string | null;
    submittedById: string | null;
    qcApprovedById: string | null;
    assignedQcExecId?: string | null;
  },
): DocumentAllowedAction[] {
  if (doc.docType === DocType.COA) {
    return resolveCoaAllowedActions(doc.status, role);
  }

  const entityType = resolveWorkflowEntityType(doc.docType);
  if (!entityType) return [];

  return getAllowedActions(
    entityType,
    doc.status as WorkflowStatus,
    role,
    actorUserId,
    entityMeta,
  );
}
