import {
  BatchStatus,
  DeptName,
  DocStatus,
  DocType,
  Prisma,
  Role,
  TemplateStatus,
} from "@prisma/client";
import { prisma } from "../../lib/prisma-types";
import { AppError } from "../../lib/app-error";
import { JwtAccessPayload } from "../../types/auth.types";
import { AuditAction, AuditEntityType, log as auditLog } from "../../services/audit.service";
import { batchLink } from "../../services/notification-links";
import { notify } from "../../services/notification.service";
import {
  authoringTransition,
  transition,
} from "../../services/workflow-engine";
import {
  resolveWorkflowEntityType,
  WorkflowAction,
} from "../../services/workflow.config";
import { getUserById, verifyUserPassword } from "../auth/auth.service";
import {
  findDepartmentIdByName,
  resolveRecipients,
} from "../notifications/notifications.repository";
import * as batchesRepo from "../batches/batches.repository";
import { toDocumentDetail, resolveDocumentAllowedActions } from "./documents.mapper";
import { CreateSpecBody } from "./documents.schema";
import { DocumentDetailDto } from "./documents.types";
import * as documentsRepo from "./documents.repository";

type TemplateTestWithParameter = Prisma.SpecTemplateTestGetPayload<{
  include: { testParameter: true };
}>;

function resolveEffectiveTemplateTests(
  templateTests: TemplateTestWithParameter[],
  optionalTestIds: string[],
): TemplateTestWithParameter[] {
  const included = templateTests.filter((t) => t.isIncluded);
  const optionalById = new Map(
    templateTests.filter((t) => t.isOptional).map((t) => [t.id, t]),
  );

  for (const optionalId of optionalTestIds) {
    const optionalTest = optionalById.get(optionalId);
    if (!optionalTest) {
      throw AppError.optionalTestInvalid();
    }
    if (!included.some((t) => t.id === optionalId)) {
      included.push(optionalTest);
    }
  }

  return included.sort((a, b) => a.sortOrder - b.sortOrder);
}

function buildSpecDocumentTestRows(
  specDocumentId: string,
  effectiveTests: TemplateTestWithParameter[],
  optionalTestIds: string[],
): Prisma.SpecDocumentTestCreateManyInput[] {
  return effectiveTests.map((templateTest) => {
    const tp = templateTest.testParameter;
    return {
      batchDocumentId: specDocumentId,
      testParameterId: templateTest.testParameterId,
      sortOrder: templateTest.sortOrder,
      testName: tp.testName,
      isMandatory: tp.isMandatory,
      isOptionalActivated: optionalTestIds.includes(templateTest.id),
      resultType: tp.resultType,
      acceptanceCriteria: templateTest.overrideAcceptance ?? tp.acceptanceCriteria ?? null,
      minValue: templateTest.overrideMinValue ?? tp.minValue ?? null,
      maxValue: templateTest.overrideMaxValue ?? tp.maxValue ?? null,
      operator: tp.operator,
      uom: tp.uom,
      departmentId: tp.departmentId,
    };
  });
}

export async function populateSpecDocument(
  batchId: string,
  body: CreateSpecBody,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<DocumentDetailDto> {
  const batch = await documentsRepo.findBatchForSpecPopulate(batchId);

  if (!batch) {
    throw AppError.notFound("Batch");
  }

  if (batch.status !== BatchStatus.ACTIVE) {
    throw AppError.conflict("Batch must be ACTIVE to populate SPEC document");
  }

  if (!batch.assignedQcExecId || actor.userId !== batch.assignedQcExecId) {
    throw AppError.notAssignee();
  }

  const specDoc = batch.batchDocuments[0];
  if (!specDoc) {
    throw AppError.notFound("SPEC document");
  }

  if (specDoc.status !== DocStatus.PENDING) {
    throw AppError.alreadyStarted();
  }

  if (batch.specTemplate.status !== TemplateStatus.QA_SIGNED) {
    throw AppError.templateNotSigned();
  }

  const optionalTestIds = body.optionalTestIds ?? [];
  const effectiveTests = resolveEffectiveTemplateTests(
    batch.specTemplate.specTemplateTests,
    optionalTestIds,
  );

  await prisma.$transaction(async (tx) => {
    await documentsRepo.deleteSpecDocumentTests(specDoc.id, tx);
    await documentsRepo.createSpecDocumentTests(
      buildSpecDocumentTestRows(specDoc.id, effectiveTests, optionalTestIds),
      tx,
    );
    await documentsRepo.updateOptionalTestsActivated(specDoc.id, optionalTestIds, tx);

    await authoringTransition({
      entityType: "SPEC_DOCUMENT",
      entityId: specDoc.id,
      actor,
      tx,
    });
  });

  const actorUser = await getUserById(actor.userId);
  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.CREATE,
    entityType: AuditEntityType.SPEC,
    entityId: specDoc.id,
    docNo: specDoc.docNo,
    comment: "populated from template",
    ipAddress,
  });

  return getDocumentDetail(specDoc.id, actor);
}

export async function getDocumentDetail(
  documentId: string,
  actor: JwtAccessPayload,
): Promise<DocumentDetailDto> {
  const doc = await documentsRepo.findDocumentDetail(documentId);

  if (!doc) {
    throw AppError.notFound("Document");
  }

  const entityType = resolveWorkflowEntityType(doc.docType);
  const allowedActions = resolveDocumentAllowedActions(
    doc,
    actor.role,
    actor.userId,
    {
      createdById: doc.createdById,
      submittedById: doc.submittedById,
      qcApprovedById: doc.qcApprovedById,
      assignedQcExecId: doc.batch.assignedQcExecId,
    },
  );

  return toDocumentDetail(doc, allowedActions);
}

function resolveEntityTypeOrThrow(docType: DocType) {
  const entityType = resolveWorkflowEntityType(docType);
  if (!entityType) {
    throw AppError.forbidden("Document lifecycle is not yet implemented for this document type");
  }
  return entityType;
}

export async function transitionDocument(
  documentId: string,
  action: WorkflowAction,
  actor: JwtAccessPayload,
  password: string,
  ipAddress?: string,
  comment?: string,
): Promise<DocumentDetailDto> {
  const doc = await documentsRepo.findDocumentDetail(documentId);
  if (!doc) {
    throw AppError.notFound("Document");
  }

  const entityType = resolveEntityTypeOrThrow(doc.docType);

  await transition({
    entityType,
    entityId: documentId,
    action,
    actor,
    password,
    comment,
    ipAddress,
  });

  return getDocumentDetail(documentId, actor);
}

export async function signAndIssueCoa(
  documentId: string,
  actor: JwtAccessPayload,
  password: string,
  ipAddress?: string,
): Promise<DocumentDetailDto> {
  const doc = await documentsRepo.findDocumentDetail(documentId);
  if (!doc) {
    throw AppError.notFound("Document");
  }

  if (doc.docType !== DocType.COA) {
    throw AppError.coaNotSignable("Sign-and-issue is only available for COA documents");
  }

  if (doc.status !== DocStatus.AUTO_GENERATED) {
    throw AppError.coaNotSignable();
  }

  if (actor.role !== Role.QA_MGR) {
    throw AppError.forbidden("Role QA_MGR is required for COA sign-and-issue");
  }

  await verifyUserPassword(actor.userId, password);

  const actorUser = await getUserById(actor.userId);

  const batchMeta = await prisma.batch.findUnique({
    where: { id: doc.batchId },
    select: { arn: true, batchNo: true, createdById: true, assignedQcExecId: true },
  });

  await prisma.$transaction(async (tx) => {
    await batchesRepo.transitionCoaDocumentToIssued(documentId, tx);
    const released = await batchesRepo.releaseBatch(doc.batchId, tx);

    if (batchMeta?.arn) {
      const recipientIds = new Set<string>();
      if (batchMeta.createdById) recipientIds.add(batchMeta.createdById);
      if (batchMeta.assignedQcExecId) recipientIds.add(batchMeta.assignedQcExecId);

      const qcDeptId = await findDepartmentIdByName(DeptName.QC, tx);
      const qaDeptId = await findDepartmentIdByName(DeptName.QA, tx);
      const mktDeptId = await findDepartmentIdByName(DeptName.MARKETING, tx);

      if (qcDeptId) {
        (await resolveRecipients({ role: Role.QC_MGR, departmentId: qcDeptId }, tx)).forEach(
          (id) => recipientIds.add(id),
        );
      }
      if (qaDeptId) {
        (await resolveRecipients({ role: Role.QA_MGR, departmentId: qaDeptId }, tx)).forEach(
          (id) => recipientIds.add(id),
        );
      }
      if (mktDeptId) {
        (await resolveRecipients({ role: Role.MKT_EXEC, departmentId: mktDeptId }, tx)).forEach(
          (id) => recipientIds.add(id),
        );
      }

      await notify({
        recipients: { users: [...recipientIds] },
        type: "BATCH_RELEASED",
        title: `Batch ${batchMeta.arn} released`,
        message: `Batch ${batchMeta.batchNo} (${batchMeta.arn}) has been released.`,
        link: batchLink(doc.batchId),
        excludeUserId: actor.userId,
        tx,
      });
    }
  });

  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.SIGN_ISSUE,
    entityType: AuditEntityType.COA,
    entityId: doc.id,
    docNo: doc.docNo,
    fieldChanged: "status",
    oldValue: DocStatus.AUTO_GENERATED,
    newValue: DocStatus.ISSUED,
    ipAddress,
  });

  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.UPDATE,
    entityType: AuditEntityType.BATCH,
    entityId: doc.batchId,
    fieldChanged: "status",
    oldValue: BatchStatus.ACTIVE,
    newValue: BatchStatus.RELEASED,
    comment: `Batch released via COA ${doc.docNo} sign-and-issue`,
    ipAddress,
  });

  return getDocumentDetail(documentId, actor);
}
