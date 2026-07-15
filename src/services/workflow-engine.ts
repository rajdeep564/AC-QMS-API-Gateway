import {
  BatchStatus,
  DeptName,
  DocStatus,
  DocType,
  Role,
  SpecVariant,
  StandingDocStatus,
} from "@prisma/client";
import { prisma, type Tx } from "../lib/prisma-types";
import { AppError } from "../lib/app-error";
import { JwtAccessPayload } from "../types/auth.types";
import { getUserById, verifyUserPassword } from "../modules/auth/auth.service";
import * as batchesRepo from "../modules/batches/batches.repository";
import { findDepartmentIdByName, resolveRecipients } from "../modules/notifications/notifications.repository";
import * as specsRepo from "../modules/specs/specs.repository";
import { openAwsForBatch } from "./aws-open.service";
import { enforceCoaSignIssueGuards } from "./coa-guards";
import { AuditAction, AuditEntityType, log as auditLog } from "./audit.service";
import { generateCoaFromSignedAws } from "./coa-generator";
import { notify } from "./notification.service";
import { awsDocumentLink, batchLink, standingSpecLink } from "./notification-links";
import { renderDocuments } from "./render-documents.service";
import {
  findTransitionRule,
  WorkflowAction,
  WorkflowEntityMeta,
  WorkflowEntityType,
  WorkflowStatus,
} from "./workflow.config";

export type TransitionInput = {
  entityType: WorkflowEntityType;
  entityId: string;
  action: WorkflowAction;
  actor: JwtAccessPayload;
  password?: string;
  comment?: string;
  ipAddress?: string;
  tx?: Tx;
};

type StandingEntityRecord = {
  id: string;
  status: WorkflowStatus;
  createdById: string;
  submittedById: string | null;
  qcApprovedById: string | null;
  productId: string;
  variant: string;
  supersedesId: string | null;
  specNo: string;
  revisionNo: number;
  effectiveDate: Date | null;
};

type BatchEntityRecord = {
  id: string;
  status: WorkflowStatus;
  createdById: string;
  batchNo: string;
  assignedQcExecId: string | null;
};

type AwsDocumentRecord = {
  id: string;
  status: WorkflowStatus;
  docNo: string;
  batchId: string;
  createdById: string | null;
  submittedById: string | null;
  qcApprovedById: string | null;
  assignedQcExecId: string | null;
};

type CoaDocumentRecord = {
  id: string;
  status: WorkflowStatus;
  docNo: string;
  batchId: string;
  batchNo: string;
  batchArnNo: string | null;
  batchStatus: BatchStatus;
  batchCreatedById: string | null;
  batchAssignedQcExecId: string | null;
  awsQcApprovedById: string | null;
};

function requiresPassword(entityType: WorkflowEntityType, action: WorkflowAction): boolean {
  if (entityType === "BATCH") return action === "APPROVE";
  if (entityType === "COA_DOCUMENT") return action === "SIGN_ISSUE";
  if (entityType === "AWS_DOCUMENT") {
    return action === "SUBMIT" || action === "APPROVE" || action === "SIGN";
  }
  return action === "APPROVE" || action === "SIGN";
}

function auditActionForWorkflow(action: WorkflowAction): AuditAction {
  switch (action) {
    case "SUBMIT":
      return AuditAction.SUBMIT;
    case "APPROVE":
      return AuditAction.APPROVE;
    case "SIGN":
      return AuditAction.SIGN;
    case "SIGN_ISSUE":
      return AuditAction.SIGN_ISSUE;
    case "REJECT":
      return AuditAction.REJECT;
    default:
      return AuditAction.UPDATE;
  }
}

export function getAllowedActions(
  entityType: WorkflowEntityType,
  status: WorkflowStatus,
  role: Role,
  actorUserId: string,
  entityMeta: WorkflowEntityMeta,
): WorkflowAction[] {
  if (entityType === "STANDING_SPEC") {
    const actions: WorkflowAction[] = [];
    if (status === "DRAFT" && role === Role.QC_EXEC && actorUserId === entityMeta.createdById) {
      actions.push("SUBMIT");
    }
    if (status === "SUBMITTED" && role === Role.QC_MGR) {
      actions.push("APPROVE", "REJECT");
    }
    if (status === "QC_APPROVED" && role === Role.QA_MGR) {
      actions.push("SIGN", "REJECT");
    }
    return actions;
  }
  if (entityType === "BATCH") {
    return getAllowedBatchActions(status, role, actorUserId, entityMeta);
  }
  if (entityType === "AWS_DOCUMENT") {
    return getAllowedAwsDocumentActions(status, role, actorUserId, entityMeta);
  }
  if (entityType === "COA_DOCUMENT") {
    return getAllowedCoaDocumentActions(status, role);
  }
  return [];
}

export function getAllowedBatchActions(
  status: WorkflowStatus,
  role: Role,
  _actorUserId: string,
  _entityMeta: WorkflowEntityMeta,
): WorkflowAction[] {
  const actions: WorkflowAction[] = [];
  if (status === "DRAFT" && role === Role.QC_MGR) actions.push("SUBMIT");
  if (status === "PENDING_APPROVAL" && role === Role.QA_MGR) {
    actions.push("APPROVE", "REJECT");
  }
  return actions;
}

export function getAllowedAwsDocumentActions(
  status: WorkflowStatus,
  role: Role,
  actorUserId: string,
  entityMeta: WorkflowEntityMeta,
): WorkflowAction[] {
  const actions: WorkflowAction[] = [];
  if (
    status === "DRAFT" &&
    role === Role.QC_EXEC &&
    entityMeta.assignedQcExecId === actorUserId
  ) {
    actions.push("SUBMIT");
  }
  if (status === "SUBMITTED" && role === Role.QC_MGR) {
    actions.push("APPROVE", "REJECT");
  }
  if (status === "QC_APPROVED" && role === Role.QA_MGR) {
    actions.push("SIGN", "REJECT");
  }
  return actions;
}

/** US-13-7 — QA_MGR may sign-and-issue when COA is AUTO_GENERATED. */
export function getAllowedCoaDocumentActions(
  status: WorkflowStatus,
  role: Role,
): WorkflowAction[] {
  if (status === "AUTO_GENERATED" && role === Role.QA_MGR) {
    return ["SIGN_ISSUE"];
  }
  return [];
}

async function loadStandingSpec(entityId: string, tx?: Tx): Promise<StandingEntityRecord> {
  const spec = await specsRepo.findSpecWithDetails(entityId, tx ?? prisma);
  if (!spec) throw AppError.notFound("Standing SPEC");
  return {
    id: spec.id,
    status: spec.status as WorkflowStatus,
    createdById: spec.createdById,
    submittedById: spec.submittedById,
    qcApprovedById: spec.qcApprovedById,
    productId: spec.productId,
    variant: spec.variant,
    supersedesId: spec.supersedesId,
    specNo: spec.specNo,
    revisionNo: spec.revisionNo,
    effectiveDate: spec.effectiveDate,
  };
}

async function loadBatch(entityId: string, tx?: Tx): Promise<BatchEntityRecord> {
  const batch = await batchesRepo.findBatchById(entityId, tx ?? prisma);
  if (!batch) throw AppError.notFound("Batch");
  return {
    id: batch.id,
    status: batch.status as WorkflowStatus,
    createdById: batch.createdById,
    batchNo: batch.batchNo,
    assignedQcExecId: batch.assignedQcExecId,
  };
}

async function loadAwsDocument(entityId: string, tx?: Tx): Promise<AwsDocumentRecord> {
  const doc = await batchesRepo.findBatchDocumentById(entityId, tx ?? prisma);
  if (!doc) throw AppError.notFound("Batch document");
  return {
    id: doc.id,
    status: doc.status as WorkflowStatus,
    docNo: doc.docNo,
    batchId: doc.batchId,
    createdById: doc.createdById,
    submittedById: doc.submittedById,
    qcApprovedById: doc.qcApprovedById,
    assignedQcExecId: doc.batch.assignedQcExecId,
  };
}

async function loadCoaDocument(entityId: string, tx?: Tx): Promise<CoaDocumentRecord> {
  const doc = await batchesRepo.findBatchDocumentById(entityId, tx ?? prisma);
  if (!doc) throw AppError.notFound("Batch document");

  const awsDoc = await batchesRepo.findBatchDocumentByType(doc.batchId, DocType.AWS, tx ?? prisma);

  return {
    id: doc.id,
    status: doc.status as WorkflowStatus,
    docNo: doc.docNo,
    batchId: doc.batchId,
    batchNo: doc.batch.batchNo,
    batchArnNo: doc.batch.arnNo,
    batchStatus: doc.batch.status,
    batchCreatedById: doc.batch.createdById,
    batchAssignedQcExecId: doc.batch.assignedQcExecId,
    awsQcApprovedById: awsDoc?.qcApprovedById ?? null,
  };
}

function buildStandingStatusUpdate(
  action: WorkflowAction,
  actorUserId: string,
  toStatus: WorkflowStatus,
  entity: StandingEntityRecord,
): specsRepo.StandingSpecStatusUpdate {
  const now = new Date();
  switch (action) {
    case "SUBMIT":
      return {
        status: toStatus as StandingDocStatus,
        submittedById: actorUserId,
        qcApprovedById: null,
        qaSignedById: null,
        approvedAt: null,
      };
    case "APPROVE":
      return { status: toStatus as StandingDocStatus, qcApprovedById: actorUserId };
    case "SIGN":
      return {
        status: toStatus as StandingDocStatus,
        qaSignedById: actorUserId,
        approvedAt: now,
        effectiveDate: entity.effectiveDate ?? now,
      };
    case "REJECT":
      return {
        status: toStatus as StandingDocStatus,
        submittedById: null,
        qcApprovedById: null,
        qaSignedById: null,
        approvedAt: null,
      };
    default:
      return { status: toStatus as StandingDocStatus };
  }
}

function buildBatchDocumentStatusUpdate(
  action: WorkflowAction,
  actorUserId: string,
  toStatus: WorkflowStatus,
): {
  status: DocStatus;
  submittedById?: string | null;
  qcApprovedById?: string | null;
  qaSignedById?: string | null;
  createdById?: string | null;
} {
  switch (action) {
    case "SUBMIT":
      return {
        status: toStatus as DocStatus,
        submittedById: actorUserId,
        qcApprovedById: null,
        qaSignedById: null,
      };
    case "APPROVE":
      return { status: toStatus as DocStatus, qcApprovedById: actorUserId };
    case "SIGN":
      return { status: toStatus as DocStatus, qaSignedById: actorUserId };
    case "REJECT":
      return {
        status: toStatus as DocStatus,
        submittedById: null,
        qcApprovedById: null,
        qaSignedById: null,
      };
    default:
      return { status: toStatus as DocStatus };
  }
}

function enforceStandingGuards(
  action: WorkflowAction,
  entity: StandingEntityRecord,
  actorUserId: string,
  testCount: number,
  hasMoa: boolean,
): void {
  if (action === "SUBMIT") {
    if (actorUserId !== entity.createdById) {
      throw AppError.forbidden("Only the creator can submit this SPEC");
    }
    if (testCount < 1) {
      throw AppError.validation("At least one test is required before submission");
    }
    if (!hasMoa) {
      throw AppError.conflict("Paired MOA must be authored before submission");
    }
  }
  if (action === "APPROVE") {
    if (actorUserId === entity.createdById || actorUserId === entity.submittedById) {
      throw AppError.selfApproval("Approver cannot be the creator or submitter");
    }
  }
  if (action === "SIGN") {
    if (actorUserId === entity.qcApprovedById || actorUserId === entity.createdById) {
      throw AppError.selfApproval("Signer cannot be the QC approver or author");
    }
  }
}

function enforceAwsDocumentGuards(
  action: WorkflowAction,
  entity: AwsDocumentRecord,
  actorUserId: string,
): void {
  if (action === "SUBMIT") {
    if (entity.assignedQcExecId !== actorUserId) {
      throw AppError.notAssignee();
    }
  }
  if (action === "APPROVE") {
    if (actorUserId === entity.submittedById) {
      throw AppError.selfApproval("Approver cannot be the submitter");
    }
  }
  if (action === "SIGN") {
    if (actorUserId === entity.qcApprovedById || actorUserId === entity.submittedById) {
      throw AppError.selfApproval("Signer cannot be the QC approver or submitter");
    }
  }
}

function enforceBatchGuards(
  action: WorkflowAction,
  entity: BatchEntityRecord,
  actorUserId: string,
): void {
  if (action === "APPROVE") {
    if (actorUserId === entity.createdById) {
      throw AppError.selfApproval("Approver cannot be the batch creator");
    }
  }
}

async function onStandingSpecSigned(
  tx: Tx,
  entity: StandingEntityRecord,
  actor: JwtAccessPayload,
): Promise<void> {
  if (entity.supersedesId) {
    await specsRepo.supersedeSpecPair(entity.supersedesId, tx, {
      userId: actor.userId,
      action: AuditAction.SUPERSEDE,
      entityType: AuditEntityType.SPEC,
      entityId: entity.supersedesId,
      oldStatus: StandingDocStatus.QA_SIGNED,
    });
  }

  const otherSigned = await specsRepo.countQaSignedSpecs(
    entity.productId,
    entity.variant as SpecVariant,
    entity.id,
    tx,
  );
  if (otherSigned > 0) {
    throw AppError.conflict("Only one QA_SIGNED SPEC may exist per product and variant");
  }

  await renderDocuments(
    "STANDING_SPEC",
    entity.id,
    {
      userId: actor.userId,
      docNo: entity.specNo,
    },
    tx,
  );
}

async function dispatchStandingNotifications(
  action: WorkflowAction,
  entity: StandingEntityRecord,
  actor: JwtAccessPayload,
  tx: Tx,
  comment?: string,
): Promise<void> {
  const link = standingSpecLink(entity.id);
  const label = `SPEC ${entity.specNo}`;

  switch (action) {
    case "SUBMIT":
      await notify({
        recipients: { role: Role.QC_MGR, departmentId: actor.departmentId ?? undefined },
        type: "SPEC_SUBMITTED",
        title: "SPEC+MOA submitted for approval",
        message: `${label} submitted for QC approval.`,
        link,
        excludeUserId: actor.userId,
        tx,
      });
      break;
    case "APPROVE": {
      const qaDeptId = await findDepartmentIdByName(DeptName.QA, tx);
      await notify({
        recipients: { role: Role.QA_MGR, departmentId: qaDeptId ?? undefined },
        type: "SPEC_QC_APPROVED",
        title: "SPEC+MOA awaiting QA signature",
        message: `${label} approved by QC, awaiting QA signature.`,
        link,
        excludeUserId: actor.userId,
        tx,
      });
      break;
    }
    case "SIGN":
      await notify({
        recipients: { users: [entity.createdById] },
        type: "SPEC_QA_SIGNED",
        title: "SPEC+MOA QA signed",
        message: `${label} has been QA signed and is batch-ready.`,
        link,
        excludeUserId: actor.userId,
        tx,
      });
      break;
    case "REJECT": {
      const rejectionNote = comment?.trim() ? ` Reason: ${comment.trim()}` : "";
      await notify({
        recipients: { users: [entity.createdById] },
        type: "SPEC_REJECTED",
        title: "SPEC+MOA rejected",
        message: `${label} was rejected.${rejectionNote}`,
        link,
        excludeUserId: actor.userId,
        tx,
      });
      break;
    }
    default:
      break;
  }
}

async function dispatchBatchNotifications(
  action: WorkflowAction,
  entity: BatchEntityRecord,
  actor: JwtAccessPayload,
  tx: Tx,
  comment?: string,
): Promise<void> {
  const link = batchLink(entity.id);
  const label = `Batch ${entity.batchNo}`;

  switch (action) {
    case "SUBMIT": {
      const qaDeptId = await findDepartmentIdByName(DeptName.QA, tx);
      await notify({
        recipients: { role: Role.QA_MGR, departmentId: qaDeptId ?? undefined },
        type: "BATCH_SUBMITTED",
        title: "Batch submitted for QA approval",
        message: `${label} submitted for QA approval.`,
        link,
        excludeUserId: actor.userId,
        tx,
      });
      break;
    }
    case "APPROVE":
      await notify({
        recipients: { users: entity.assignedQcExecId ? [entity.assignedQcExecId] : [] },
        type: "BATCH_APPROVED",
        title: "Batch approved — AWS ready",
        message: `${label} approved. AWS protocol is ready for execution.`,
        link,
        excludeUserId: actor.userId,
        tx,
      });
      break;
    case "REJECT": {
      const rejectionNote = comment?.trim() ? ` Reason: ${comment.trim()}` : "";
      await notify({
        recipients: { users: [entity.createdById] },
        type: "BATCH_REJECTED",
        title: "Batch rejected",
        message: `${label} was rejected.${rejectionNote}`,
        link,
        excludeUserId: actor.userId,
        tx,
      });
      break;
    }
    default:
      break;
  }
}

async function dispatchAwsDocumentNotifications(
  action: WorkflowAction,
  entity: AwsDocumentRecord,
  actor: JwtAccessPayload,
  tx: Tx,
  comment?: string,
  fromStatus?: WorkflowStatus,
): Promise<void> {
  const link = awsDocumentLink(entity.id);
  const label = `AWS ${entity.docNo}`;

  switch (action) {
    case "SUBMIT":
      await notify({
        recipients: { role: Role.QC_MGR, departmentId: actor.departmentId ?? undefined },
        type: "AWS_SUBMITTED",
        title: "AWS submitted for QC approval",
        message: `${label} submitted for QC approval.`,
        link,
        excludeUserId: actor.userId,
        tx,
      });
      break;
    case "APPROVE": {
      const qaDeptId = await findDepartmentIdByName(DeptName.QA, tx);
      await notify({
        recipients: { role: Role.QA_MGR, departmentId: qaDeptId ?? undefined },
        type: "AWS_QC_APPROVED",
        title: "AWS awaiting QA signature",
        message: `${label} approved by QC, awaiting QA signature.`,
        link,
        excludeUserId: actor.userId,
        tx,
      });
      break;
    }
    case "SIGN":
      await notify({
        recipients: { users: entity.assignedQcExecId ? [entity.assignedQcExecId] : [] },
        type: "AWS_QA_SIGNED",
        title: "AWS QA signed",
        message: `${label} has been QA signed. COA auto-generated.`,
        link,
        excludeUserId: actor.userId,
        tx,
      });
      break;
    case "REJECT": {
      const rejectionNote = comment?.trim() ? ` Reason: ${comment.trim()}` : "";
      const recipientIds = new Set<string>();
      if (entity.assignedQcExecId) recipientIds.add(entity.assignedQcExecId);
      if (fromStatus === "QC_APPROVED") {
        if (entity.qcApprovedById) recipientIds.add(entity.qcApprovedById);
        const qcDeptId = await findDepartmentIdByName(DeptName.QC, tx);
        if (qcDeptId) {
          (await resolveRecipients({ role: Role.QC_MGR, departmentId: qcDeptId }, tx)).forEach(
            (id) => recipientIds.add(id),
          );
        }
      }
      await notify({
        recipients: { users: [...recipientIds] },
        type: "AWS_REJECTED",
        title: "AWS rejected",
        message: `${label} was rejected.${rejectionNote}`,
        link,
        excludeUserId: actor.userId,
        tx,
      });
      break;
    }
    default:
      break;
  }
}

/** US-13-9 / Epic 14 — notify QC/QA on batch release; Production/Stores deferred. */
async function dispatchCoaSignIssueNotifications(
  entity: CoaDocumentRecord,
  actor: JwtAccessPayload,
  tx: Tx,
): Promise<void> {
  if (!entity.batchArnNo) return;

  const recipientIds = new Set<string>();
  if (entity.batchCreatedById) recipientIds.add(entity.batchCreatedById);
  if (entity.batchAssignedQcExecId) recipientIds.add(entity.batchAssignedQcExecId);

  const qcDeptId = await findDepartmentIdByName(DeptName.QC, tx);
  const qaDeptId = await findDepartmentIdByName(DeptName.QA, tx);

  if (qcDeptId) {
    (await resolveRecipients({ role: Role.QC_MGR, departmentId: qcDeptId }, tx)).forEach((id) =>
      recipientIds.add(id),
    );
  }
  if (qaDeptId) {
    (await resolveRecipients({ role: Role.QA_MGR, departmentId: qaDeptId }, tx)).forEach((id) =>
      recipientIds.add(id),
    );
  }

  // TODO US-13-9: notify Production and Stores user groups when modeled in Phase 1 schema.

  await notify({
    recipients: { users: [...recipientIds] },
    type: "BATCH_RELEASED",
    title: `Batch ${entity.batchArnNo} released`,
    message: `Batch ${entity.batchNo} (${entity.batchArnNo}) has been released.`,
    link: batchLink(entity.batchId),
    excludeUserId: actor.userId,
    tx,
  });
}

async function transitionStandingSpec(input: TransitionInput) {
  const entity = await loadStandingSpec(input.entityId, input.tx);
  const fromStatus = entity.status;
  const rule = findTransitionRule("STANDING_SPEC", fromStatus, input.action);
  if (!rule) {
    throw AppError.illegalTransition(`Illegal transition ${fromStatus} → ${input.action}`);
  }
  if (input.actor.role !== rule.requiredRole) {
    throw AppError.forbidden(`Role ${rule.requiredRole} is required for this action`);
  }

  const testCount = await specsRepo.countSpecTests(input.entityId, input.tx ?? prisma);
  const hasMoa = await specsRepo.hasMoaWithSections(input.entityId, input.tx ?? prisma);
  enforceStandingGuards(input.action, entity, input.actor.userId, testCount, hasMoa);

  if (input.action === "REJECT" && (!input.comment || input.comment.trim() === "")) {
    throw AppError.validation("Rejection comment is required");
  }
  if (requiresPassword("STANDING_SPEC", input.action) && !input.password) {
    throw AppError.validation("Password is required for this action");
  }
  if (requiresPassword("STANDING_SPEC", input.action)) {
    await verifyUserPassword(input.actor.userId, input.password!);
  }

  const actorUser = await getUserById(input.actor.userId);

  const runTransition = async (tx: Tx) => {
    await specsRepo.updateSpecAndMoaStatus(
      input.entityId,
      buildStandingStatusUpdate(input.action, input.actor.userId, rule.toStatus, entity),
      tx,
      {
        userId: input.actor.userId,
        userName: actorUser?.fullName,
        role: input.actor.role,
        department: actorUser?.department?.name,
        action: auditActionForWorkflow(input.action),
        entityType: AuditEntityType.SPEC,
        entityId: entity.id,
        docNo: entity.specNo,
        fieldChanged: "status",
        oldStatus: fromStatus as StandingDocStatus,
        comment: input.comment,
        ipAddress: input.ipAddress,
      },
    );
    if (input.action === "SIGN" && rule.toStatus === "QA_SIGNED") {
      await onStandingSpecSigned(tx, entity, input.actor);
    }
    await dispatchStandingNotifications(input.action, entity, input.actor, tx, input.comment);
    return specsRepo.findSpecWithDetails(input.entityId, tx);
  };

  const updated = input.tx
    ? await runTransition(input.tx)
    : await prisma.$transaction(runTransition);

  return updated;
}

async function transitionBatch(input: TransitionInput) {
  const entity = await loadBatch(input.entityId, input.tx);
  const fromStatus = entity.status;
  const rule = findTransitionRule("BATCH", fromStatus, input.action);
  if (!rule) {
    throw AppError.illegalTransition(`Illegal transition ${fromStatus} → ${input.action}`);
  }
  if (input.actor.role !== rule.requiredRole) {
    throw AppError.forbidden(`Role ${rule.requiredRole} is required for this action`);
  }

  enforceBatchGuards(input.action, entity, input.actor.userId);

  if (input.action === "REJECT" && (!input.comment || input.comment.trim() === "")) {
    throw AppError.validation("Rejection comment is required");
  }
  if (requiresPassword("BATCH", input.action) && !input.password) {
    throw AppError.validation("Password is required for this action");
  }
  if (requiresPassword("BATCH", input.action)) {
    await verifyUserPassword(input.actor.userId, input.password!);
  }

  const actorUser = await getUserById(input.actor.userId);

  const runTransition = async (tx: Tx) => {
    await batchesRepo.updateBatchStatus(
      input.entityId,
      {
        status: rule.toStatus as BatchStatus,
        approvedById: input.action === "APPROVE" ? input.actor.userId : undefined,
      },
      tx,
    );

    if (input.action === "APPROVE" && rule.toStatus === "APPROVED") {
      await openAwsForBatch(tx, input.entityId);
    }

    await auditLog(
      {
        userId: input.actor.userId,
        userName: actorUser?.fullName,
        role: input.actor.role,
        department: actorUser?.department?.name,
        action: auditActionForWorkflow(input.action),
        entityType: AuditEntityType.BATCH,
        entityId: entity.id,
        docNo: entity.batchNo,
        fieldChanged: "status",
        oldValue: fromStatus,
        newValue: rule.toStatus,
        comment: input.comment,
        ipAddress: input.ipAddress,
      },
      tx,
    );

    await dispatchBatchNotifications(input.action, entity, input.actor, tx, input.comment);
    return batchesRepo.findBatchWithDetails(input.entityId, tx);
  };

  const updated = input.tx
    ? await runTransition(input.tx)
    : await prisma.$transaction(runTransition);

  return updated;
}

async function transitionAwsDocument(input: TransitionInput) {
  const entity = await loadAwsDocument(input.entityId, input.tx);
  const fromStatus = entity.status;
  const rule = findTransitionRule("AWS_DOCUMENT", fromStatus, input.action);
  if (!rule) {
    throw AppError.illegalTransition(`Illegal transition ${fromStatus} → ${input.action}`);
  }
  if (input.actor.role !== rule.requiredRole) {
    throw AppError.forbidden(`Role ${rule.requiredRole} is required for this action`);
  }

  enforceAwsDocumentGuards(input.action, entity, input.actor.userId);

  if (input.action === "SUBMIT") {
    const summary = await batchesRepo.countAwsSectionCompletion(
      input.entityId,
      input.tx ?? prisma,
    );
    if (!summary.allComplete) {
      throw AppError.validation(
        `${summary.incomplete} of ${summary.total} sections incomplete`,
      );
    }
  }

  if (input.action === "REJECT" && (!input.comment || input.comment.trim() === "")) {
    throw AppError.validation("Rejection comment is required");
  }
  if (requiresPassword("AWS_DOCUMENT", input.action) && !input.password) {
    throw AppError.validation("Password is required for this action");
  }
  if (requiresPassword("AWS_DOCUMENT", input.action)) {
    await verifyUserPassword(input.actor.userId, input.password!);
  }

  const actorUser = await getUserById(input.actor.userId);

  const runTransition = async (tx: Tx) => {
    const statusUpdate = buildBatchDocumentStatusUpdate(
      input.action,
      input.actor.userId,
      rule.toStatus,
    );
    if (input.action === "SUBMIT" && !entity.createdById) {
      statusUpdate.createdById = input.actor.userId;
    }

    await batchesRepo.updateBatchDocumentWorkflow(input.entityId, statusUpdate, tx);

    if (input.action === "REJECT") {
      await batchesRepo.reopenAwsSectionsForRework(input.entityId, tx);
    }

    if (input.action === "SIGN" && rule.toStatus === "QA_SIGNED") {
      await renderDocuments(
        "AWS",
        input.entityId,
        {
          userId: input.actor.userId,
          docNo: entity.docNo,
        },
        tx,
      );
      await generateCoaFromSignedAws(tx, entity.batchId, input.entityId, entity.docNo);
    }

    await auditLog(
      {
        userId: input.actor.userId,
        userName: actorUser?.fullName,
        role: input.actor.role,
        department: actorUser?.department?.name,
        action: auditActionForWorkflow(input.action),
        entityType: AuditEntityType.AWS,
        entityId: entity.id,
        docNo: entity.docNo,
        fieldChanged: "status",
        oldValue: fromStatus,
        newValue: rule.toStatus,
        comment: input.comment,
        ipAddress: input.ipAddress,
      },
      tx,
    );

    await dispatchAwsDocumentNotifications(
      input.action,
      entity,
      input.actor,
      tx,
      input.comment,
      fromStatus,
    );
    return batchesRepo.findBatchDocumentWithDetails(input.entityId, tx);
  };

  const updated = input.tx
    ? await runTransition(input.tx)
    : await prisma.$transaction(runTransition);

  return updated;
}

/** US-13-7/8/9 — COA sign-and-issue via workflow engine (S4). */
async function transitionCoaDocument(input: TransitionInput) {
  const entity = await loadCoaDocument(input.entityId, input.tx);
  const fromStatus = entity.status;
  const rule = findTransitionRule("COA_DOCUMENT", fromStatus, input.action);
  if (!rule) {
    throw AppError.illegalTransition(`Illegal transition ${fromStatus} → ${input.action}`);
  }
  if (input.actor.role !== rule.requiredRole) {
    throw AppError.forbidden(`Role ${rule.requiredRole} is required for this action`);
  }

  if (input.action === "SIGN_ISSUE") {
    enforceCoaSignIssueGuards(entity.awsQcApprovedById, input.actor.userId);
  }

  if (!input.password) {
    throw AppError.validation("Password is required for this action");
  }
  await verifyUserPassword(input.actor.userId, input.password);

  const actorUser = await getUserById(input.actor.userId);

  const runTransition = async (tx: Tx) => {
    await batchesRepo.transitionCoaDocumentToIssued(input.entityId, input.actor.userId, tx);
    await batchesRepo.releaseBatch(entity.batchId, tx);

    await dispatchCoaSignIssueNotifications(entity, input.actor, tx);

    await auditLog(
      {
        userId: input.actor.userId,
        userName: actorUser?.fullName,
        role: input.actor.role,
        department: actorUser?.department?.name,
        action: AuditAction.SIGN_ISSUE,
        entityType: AuditEntityType.COA,
        entityId: entity.id,
        docNo: entity.docNo,
        fieldChanged: "status",
        oldValue: fromStatus,
        newValue: rule.toStatus,
        ipAddress: input.ipAddress,
      },
      tx,
    );

    await auditLog(
      {
        userId: input.actor.userId,
        userName: actorUser?.fullName,
        role: input.actor.role,
        department: actorUser?.department?.name,
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.BATCH,
        entityId: entity.batchId,
        fieldChanged: "status",
        oldValue: entity.batchStatus,
        newValue: BatchStatus.RELEASED,
        comment: `Batch released via COA ${entity.docNo} sign-and-issue`,
        ipAddress: input.ipAddress,
      },
      tx,
    );

    await auditLog(
      {
        userId: input.actor.userId,
        userName: actorUser?.fullName,
        role: input.actor.role,
        department: actorUser?.department?.name,
        action: AuditAction.GENERATE,
        entityType: AuditEntityType.COA,
        entityId: entity.id,
        docNo: entity.docNo,
        comment: "COA render requested",
        ipAddress: input.ipAddress,
      },
      tx,
    );

    return batchesRepo.findBatchDocumentWithDetails(input.entityId, tx);
  };

  const updated = input.tx
    ? await runTransition(input.tx)
    : await prisma.$transaction(runTransition);

  return updated;
}

export async function transition(input: TransitionInput) {
  switch (input.entityType) {
    case "STANDING_SPEC":
      return transitionStandingSpec(input);
    case "BATCH":
      return transitionBatch(input);
    case "AWS_DOCUMENT":
      return transitionAwsDocument(input);
    case "COA_DOCUMENT":
      return transitionCoaDocument(input);
    default:
      throw AppError.fromCode("INTERNAL", "Unsupported entity type");
  }
}
