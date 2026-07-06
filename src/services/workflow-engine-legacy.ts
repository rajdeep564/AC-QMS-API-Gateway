import {
  DeptName,
  DocPhase,
  DocStatus,
  MasterStatus,
  Prisma,
  Role,
  TemplateStatus,
} from "@prisma/client";
import type { BatchDocument, ProductMaster, SpecTemplate } from "@prisma/client";
import { prisma, type Tx } from "../lib/prisma-types";
import { AppError } from "../lib/app-error";
import { JwtAccessPayload } from "../types/auth.types";
import { getUserById, verifyUserPassword } from "../modules/auth/auth.service";
import * as batchesRepo from "../modules/batches/batches.repository";
import { findDepartmentIdByName, resolveRecipients } from "../modules/notifications/notifications.repository";
import * as mastersRepo from "../modules/masters/masters.repository";
import * as specTemplatesRepo from "../modules/spec-templates/spec-templates.repository";
import { autoCreateAwsSkeletonFromSignedMoa } from "./aws-skeleton-create.service";
import { autoCreateMoaFromSignedSpec } from "./moa-auto-create.service";
import { generateCoaFromSignedAws } from "./coa-generator";
import { AuditAction, AuditEntityType, log as auditLog } from "./audit.service";
import { notify } from "./notification.service";
import {
  documentLink,
  masterLink,
  specTemplateLink,
} from "./notification-links";
import {
  findAuthoringTransitionRule,
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
  password: string;
  comment?: string;
  ipAddress?: string;
  tx?: Tx;
};

export type AuthoringTransitionInput = {
  entityType: WorkflowEntityType;
  entityId: string;
  actor?: JwtAccessPayload;
  tx: Tx;
  systemTriggered?: boolean;
};

type WorkflowEntityRecord = {
  id: string;
  status: WorkflowStatus;
  createdById: string | null;
  submittedById: string | null;
  qcApprovedById: string | null;
  revisionNo?: number;
  templateNo?: string;
  docNo?: string;
  batchId?: string;
  assignedQcExecId?: string | null;
};

type StatusUpdateData = {
  status: MasterStatus | TemplateStatus | DocStatus;
  submittedById?: string | null;
  submittedAt?: Date | null;
  qcApprovedById?: string | null;
  qcApprovedAt?: Date | null;
  qaSignedById?: string | null;
  qaSignedAt?: Date | null;
  rejectionComment?: string | null;
  rejectedById?: string | null;
  rejectedAt?: Date | null;
  createdById?: string;
};

type EntityHandler = {
  notFoundLabel: string;
  auditEntityType: AuditEntityType;
  isBatchDocument: boolean;
  load: (entityId: string, tx?: Tx) => Promise<WorkflowEntityRecord>;
  update: (tx: Tx, entityId: string, data: StatusUpdateData) => Promise<ProductMaster | SpecTemplate | BatchDocument>;
  submitTestCount: (entityId: string, tx?: Tx) => Promise<number>;
  notificationPrefix: "MASTER" | "TEMPLATE" | "SPEC" | "MOA" | "AWS";
  entityLabel: (entity: WorkflowEntityRecord) => string;
  onSigned?: (tx: Tx, entity: WorkflowEntityRecord, actor: JwtAccessPayload) => Promise<void>;
};

async function loadBatchDocumentRecord(entityId: string, tx?: Tx): Promise<WorkflowEntityRecord> {
  const doc = await batchesRepo.findBatchDocumentWithBatch(entityId, tx ?? prisma);
  if (!doc) {
    throw AppError.notFound("Batch document");
  }
  return {
    id: doc.id,
    status: doc.status as WorkflowStatus,
    createdById: doc.createdById,
    submittedById: doc.submittedById,
    qcApprovedById: doc.qcApprovedById,
    docNo: doc.docNo,
    batchId: doc.batchId,
    assignedQcExecId: doc.batch.assignedQcExecId,
  };
}

const ENTITY_HANDLERS: Record<WorkflowEntityType, EntityHandler> = {
  PRODUCT_MASTER: {
    notFoundLabel: "Product master",
    auditEntityType: AuditEntityType.MASTER,
    isBatchDocument: false,
    load: async (entityId, tx) => {
      const master = await mastersRepo.findProductMasterById(entityId, tx ?? prisma);
      if (!master) {
        throw AppError.notFound("Product master");
      }
      return {
        id: master.id,
        status: master.status as WorkflowStatus,
        createdById: master.createdById,
        submittedById: master.submittedById,
        qcApprovedById: master.qcApprovedById,
        revisionNo: master.revisionNo,
      };
    },
    update: (tx, entityId, data) =>
      mastersRepo.updateProductMaster(entityId, data as Prisma.ProductMasterUpdateInput, tx),
    submitTestCount: (entityId, tx) =>
      mastersRepo.countTestParameters(entityId, tx ?? prisma),
    notificationPrefix: "MASTER",
    entityLabel: (entity) => `revision ${entity.revisionNo}`,
  },
  SPEC_TEMPLATE: {
    notFoundLabel: "Spec template",
    auditEntityType: AuditEntityType.TEMPLATE,
    isBatchDocument: false,
    load: async (entityId, tx) => {
      const template = await specTemplatesRepo.findTemplateById(entityId, tx ?? prisma);
      if (!template) {
        throw AppError.notFound("Spec template");
      }
      return {
        id: template.id,
        status: template.status as WorkflowStatus,
        createdById: template.createdById,
        submittedById: template.submittedById,
        qcApprovedById: template.qcApprovedById,
        templateNo: template.templateNo,
      };
    },
    update: (tx, entityId, data) =>
      specTemplatesRepo.updateSpecTemplate(entityId, data as Prisma.SpecTemplateUpdateInput, tx),
    submitTestCount: (entityId, tx) =>
      specTemplatesRepo.countIncludedTemplateTests(entityId, tx ?? prisma),
    notificationPrefix: "TEMPLATE",
    entityLabel: (entity) => `template ${entity.templateNo}`,
  },
  SPEC_DOCUMENT: {
    notFoundLabel: "SPEC document",
    auditEntityType: AuditEntityType.SPEC,
    isBatchDocument: true,
    load: loadBatchDocumentRecord,
    update: (tx, entityId, data) =>
      batchesRepo.updateBatchDocument(entityId, data as Prisma.BatchDocumentUpdateInput, tx),
    submitTestCount: (entityId, tx) =>
      batchesRepo.countSpecDocumentTests(entityId, tx ?? prisma),
    notificationPrefix: "SPEC",
    entityLabel: (entity) => `document ${entity.docNo}`,
    onSigned: async (tx, entity) => {
      if (!entity.batchId || !entity.docNo) {
        throw AppError.conflict("SPEC document is missing batch context for MOA side effect");
      }
      await autoCreateMoaFromSignedSpec(tx, entity.batchId, entity.id, entity.docNo);
    },
  },
  MOA_DOCUMENT: {
    notFoundLabel: "MOA document",
    auditEntityType: AuditEntityType.MOA,
    isBatchDocument: true,
    load: loadBatchDocumentRecord,
    update: (tx, entityId, data) =>
      batchesRepo.updateBatchDocument(entityId, data as Prisma.BatchDocumentUpdateInput, tx),
    submitTestCount: (entityId, tx) =>
      batchesRepo.countMoaDocumentSections(entityId, tx ?? prisma),
    notificationPrefix: "MOA",
    entityLabel: (entity) => `document ${entity.docNo}`,
    onSigned: async (tx, entity) => {
      if (!entity.batchId || !entity.docNo) {
        throw AppError.conflict("MOA document is missing batch context for AWS side effect");
      }
      await autoCreateAwsSkeletonFromSignedMoa(tx, entity.batchId, entity.id, entity.docNo);
    },
  },
  AWS_DOCUMENT: {
    notFoundLabel: "AWS document",
    auditEntityType: AuditEntityType.AWS,
    isBatchDocument: true,
    load: loadBatchDocumentRecord,
    update: (tx, entityId, data) =>
      batchesRepo.updateBatchDocument(entityId, data as Prisma.BatchDocumentUpdateInput, tx),
    submitTestCount: (entityId, tx) =>
      batchesRepo.countAwsSections(entityId, tx ?? prisma),
    notificationPrefix: "AWS",
    entityLabel: (entity) => `document ${entity.docNo}`,
    onSigned: async (tx, entity) => {
      if (!entity.batchId || !entity.docNo) {
        throw AppError.conflict("AWS document is missing batch context for COA side effect");
      }
      await generateCoaFromSignedAws(tx, entity.batchId, entity.id, entity.docNo);
    },
  },
};

export function getAllowedActions(
  entityType: WorkflowEntityType,
  status: WorkflowStatus,
  role: Role,
  actorUserId: string,
  entityMeta: WorkflowEntityMeta,
): WorkflowAction[] {
  const actions: WorkflowAction[] = [];

  if (
    entityType === "SPEC_DOCUMENT" ||
    entityType === "MOA_DOCUMENT" ||
    entityType === "AWS_DOCUMENT"
  ) {
    if (
      status === "DRAFT" &&
      role === Role.QC_EXEC &&
      entityMeta.assignedQcExecId &&
      actorUserId === entityMeta.assignedQcExecId
    ) {
      actions.push("SUBMIT");
    }
  } else if (status === "DRAFT" && role === Role.QC_EXEC && actorUserId === entityMeta.createdById) {
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

function enforceGuards(
  entityType: WorkflowEntityType,
  action: WorkflowAction,
  entity: WorkflowEntityRecord,
  actorUserId: string,
  testCount: number,
  entityLabel: string,
): void {
  if (action === "SUBMIT") {
    if (
    entityType === "SPEC_DOCUMENT" ||
    entityType === "MOA_DOCUMENT" ||
    entityType === "AWS_DOCUMENT"
  ) {
      if (!entity.assignedQcExecId || actorUserId !== entity.assignedQcExecId) {
        throw AppError.notAssignee();
      }
    } else if (actorUserId !== entity.createdById) {
      throw AppError.forbidden(`Only the creator can submit this ${entityLabel}`);
    }
    if (testCount < 1) {
      throw AppError.validation("At least one included test is required before submission");
    }
  }

  if (action === "APPROVE") {
    if (actorUserId === entity.createdById || actorUserId === entity.submittedById) {
      throw AppError.selfApproval("Approver cannot be the creator or submitter");
    }
  }

  if (action === "SIGN") {
    if (actorUserId === entity.qcApprovedById) {
      throw AppError.selfApproval("Signer cannot be the QC approver");
    }
  }
}

function buildStatusUpdate(
  action: WorkflowAction,
  actorUserId: string,
  toStatus: WorkflowStatus,
  comment?: string,
): StatusUpdateData {
  const now = new Date();

  switch (action) {
    case "SUBMIT":
      return {
        status: toStatus as MasterStatus,
        submittedById: actorUserId,
        submittedAt: now,
      };
    case "APPROVE":
      return {
        status: toStatus as MasterStatus,
        qcApprovedById: actorUserId,
        qcApprovedAt: now,
      };
    case "SIGN":
      return {
        status: toStatus as MasterStatus,
        qaSignedById: actorUserId,
        qaSignedAt: now,
      };
    case "REJECT":
      return {
        status: toStatus as MasterStatus,
        rejectionComment: comment,
        rejectedById: actorUserId,
        rejectedAt: now,
      };
    default:
      return { status: toStatus as MasterStatus };
  }
}

async function dispatchNotifications(
  entityType: WorkflowEntityType,
  handler: EntityHandler,
  action: WorkflowAction,
  entity: WorkflowEntityRecord,
  fromStatus: WorkflowStatus,
  actor: JwtAccessPayload,
  tx: Tx,
  comment?: string,
): Promise<void> {
  const prefix = handler.notificationPrefix;
  const docNo = entity.docNo ?? entity.templateNo ?? entity.id;
  const departmentId = actor.departmentId ?? undefined;

  const entityName =
    prefix === "MASTER"
      ? "Master"
      : prefix === "TEMPLATE"
        ? "Template"
        : prefix === "MOA"
          ? "MOA"
          : prefix === "AWS"
            ? "AWS"
            : "SPEC";

  const link =
    handler.isBatchDocument && entity.batchId
      ? documentLink(entity.batchId, entity.id)
      : entityType === "PRODUCT_MASTER"
        ? masterLink(entity.id)
        : entityType === "SPEC_TEMPLATE"
          ? specTemplateLink(entity.id)
          : undefined;

  switch (action) {
    case "SUBMIT": {
      await notify({
        recipients: { role: Role.QC_MGR, departmentId },
        type: `${prefix}_SUBMITTED`,
        title: `${entityName} submitted for approval`,
        message: `${entityName} ${docNo} submitted for your approval.`,
        link,
        excludeUserId: actor.userId,
        tx,
      });
      break;
    }
    case "APPROVE": {
      const qaDeptId = await findDepartmentIdByName(DeptName.QA, tx);
      await notify({
        recipients: { role: Role.QA_MGR, departmentId: qaDeptId ?? undefined },
        type: `${prefix}_QC_APPROVED`,
        title: `${entityName} awaiting QA signature`,
        message: `${entityName} ${docNo} approved by QC, awaiting your signature.`,
        link,
        excludeUserId: actor.userId,
        tx,
      });
      break;
    }
    case "SIGN": {
      const targetUserId = entity.assignedQcExecId ?? entity.createdById;
      if (!targetUserId) break;
      await notify({
        recipients: { users: [targetUserId] },
        type: `${prefix}_QA_SIGNED`,
        title: `${entityName} QA signed`,
        message: `${entityName} ${docNo} has been QA signed.`,
        link,
        excludeUserId: actor.userId,
        tx,
      });
      break;
    }
    case "REJECT": {
      const userIds: string[] = [];
      if (entity.assignedQcExecId) {
        userIds.push(entity.assignedQcExecId);
      } else if (entity.createdById) {
        userIds.push(entity.createdById);
      }
      if (fromStatus === "QC_APPROVED" && departmentId) {
        const qcMgrs = await resolveRecipients(
          { role: Role.QC_MGR, departmentId },
          tx,
        );
        userIds.push(...qcMgrs);
      }
      if (userIds.length === 0) break;
      const rejectionNote = comment?.trim()
        ? ` Reason: ${comment.trim()}`
        : "";
      await notify({
        recipients: { users: userIds },
        type: `${prefix}_REJECTED`,
        title: `${entityName} rejected`,
        message: `${entityName} ${docNo} was rejected.${rejectionNote}`,
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

function auditActionForWorkflow(action: WorkflowAction): AuditAction {
  switch (action) {
    case "SUBMIT":
      return AuditAction.SUBMIT;
    case "APPROVE":
      return AuditAction.APPROVE;
    case "SIGN":
      return AuditAction.SIGN;
    case "REJECT":
      return AuditAction.REJECT;
    default:
      return AuditAction.UPDATE;
  }
}

export async function transitionBatchDocumentToDraft(
  tx: Tx,
  documentId: string,
  options?: { createdById?: string },
): Promise<BatchDocument> {
  const doc = await batchesRepo.findBatchDocumentById(documentId, tx);
  if (!doc) {
    throw AppError.notFound("Batch document");
  }
  if (doc.status !== DocStatus.PENDING) {
    throw AppError.illegalTransition(`Cannot transition ${doc.status} → DRAFT`);
  }

  return batchesRepo.transitionBatchDocumentToDraft(documentId, options, tx);
}

export async function authoringTransition(
  input: AuthoringTransitionInput,
): Promise<BatchDocument> {
  const handler = ENTITY_HANDLERS[input.entityType];
  if (!handler.isBatchDocument) {
    throw AppError.fromCode("INTERNAL", "Authoring transitions are only supported for batch documents");
  }

  const entity = await handler.load(input.entityId, input.tx);
  const rule = findAuthoringTransitionRule(entity.status, "DRAFT");
  if (!rule) {
    throw AppError.illegalTransition(`Illegal authoring transition ${entity.status} → DRAFT`);
  }

  if (!input.systemTriggered) {
    if (!input.actor) {
      throw AppError.fromCode("UNAUTHORIZED");
    }
    if (input.actor.role !== rule.requiredRole) {
      throw AppError.forbidden(`Role ${rule.requiredRole} is required for this action`);
    }
    if (!entity.assignedQcExecId || input.actor.userId !== entity.assignedQcExecId) {
      throw AppError.notAssignee();
    }
  }

  return transitionBatchDocumentToDraft(input.tx, input.entityId, {
    createdById: !input.systemTriggered && input.actor ? input.actor.userId : undefined,
  });
}

export async function transition(
  input: TransitionInput,
): Promise<ProductMaster | SpecTemplate | BatchDocument> {
  const handler = ENTITY_HANDLERS[input.entityType];
  if (!handler) {
    throw AppError.fromCode("INTERNAL", "Unsupported entity type");
  }

  const entity = await handler.load(input.entityId, input.tx);
  const fromStatus = entity.status;

  const rule = findTransitionRule(fromStatus, input.action);
  if (!rule) {
    throw AppError.illegalTransition(`Illegal transition ${fromStatus} → ${input.action}`);
  }

  if (input.actor.role !== rule.requiredRole) {
    throw AppError.forbidden(`Role ${rule.requiredRole} is required for this action`);
  }

  const testCount = await handler.submitTestCount(input.entityId, input.tx);
  const entityLabel =
    input.entityType === "PRODUCT_MASTER"
      ? "master"
      : input.entityType === "SPEC_TEMPLATE"
        ? "template"
        : "document";

  if (
    input.entityType === "AWS_DOCUMENT" &&
    input.action === "SUBMIT" &&
    !(await batchesRepo.allAwsSectionsComplete(input.entityId, input.tx ?? prisma))
  ) {
    throw AppError.awsSectionsIncomplete();
  }

  enforceGuards(input.entityType, input.action, entity, input.actor.userId, testCount, entityLabel);

  if (input.action === "REJECT" && (!input.comment || input.comment.trim() === "")) {
    throw AppError.validation("Rejection comment is required");
  }

  await verifyUserPassword(input.actor.userId, input.password);

  const actorUser = await getUserById(input.actor.userId);

  const runTransition = async (tx: Tx) => {
    const updated = await handler.update(
      tx,
      input.entityId,
      buildStatusUpdate(input.action, input.actor.userId, rule.toStatus, input.comment),
    );

    if (input.action === "SIGN" && rule.toStatus === "QA_SIGNED" && handler.onSigned) {
      await handler.onSigned(tx, entity, input.actor);
    }

    await dispatchNotifications(
      input.entityType,
      handler,
      input.action,
      entity,
      fromStatus,
      input.actor,
      tx,
      input.comment,
    );

    return updated;
  };

  const updated = input.tx
    ? await runTransition(input.tx)
    : await prisma.$transaction(runTransition);

  await auditLog({
    userId: input.actor.userId,
    userName: actorUser?.fullName,
    role: input.actor.role,
    department: actorUser?.department?.name,
    action: auditActionForWorkflow(input.action),
    entityType: handler.auditEntityType,
    entityId: entity.id,
    docNo: entity.docNo,
    fieldChanged: "status",
    oldValue: fromStatus,
    newValue: rule.toStatus,
    comment: input.comment,
    ipAddress: input.ipAddress,
  });

  return updated;
}
