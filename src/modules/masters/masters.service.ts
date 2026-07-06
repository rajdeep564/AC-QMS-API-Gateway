import { MasterStatus, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma-types";
import { AppError } from "../../lib/app-error";
import { JwtAccessPayload } from "../../types/auth.types";
import { AuditAction, AuditEntityType, log as auditLog } from "../../services/audit.service";
import { getMasterAllowedActions } from "../../services/master-workflow.service";
import { notify } from "../../services/notification.service";
import { masterLink } from "../../services/notification-links";
import { getUserById } from "../auth/auth.service";
import {
  AssignBody,
  CreateMasterBody,
  PatchFieldsBody,
  RejectBody,
} from "./masters.schema";
import { MasterDetailDto, MasterFieldDto } from "./masters.types";
import * as mastersRepo from "./masters.repository";

type MasterWithFields = NonNullable<Awaited<ReturnType<typeof mastersRepo.findMasterWithFields>>>;

function validateRequiredFields(fields: { fieldKey: string; value?: string | null; isRequired?: boolean }[]) {
  const missing = fields.filter((f) => f.isRequired && (!f.value || f.value.trim() === ""));
  if (missing.length > 0) {
    throw AppError.validation(
      missing.map((f) => ({
        code: "custom",
        message: `Required field '${f.fieldKey}' is missing`,
        path: ["fields", f.fieldKey],
      })),
    );
  }
}

function toFieldDto(field: MasterWithFields["fields"][number]): MasterFieldDto {
  return {
    id: field.id,
    fieldKey: field.fieldKey,
    label: field.label,
    value: field.value,
    dataType: field.dataType,
    sortOrder: field.sortOrder,
    isRequired: field.isRequired,
  };
}

function toMasterDetail(master: MasterWithFields, actor: JwtAccessPayload): MasterDetailDto {
  return {
    id: master.id,
    productId: master.productId,
    revisionNo: master.revisionNo,
    status: master.status,
    effectiveDate: master.effectiveDate,
    supersedesId: master.supersedesId,
    createdById: master.createdById,
    assignedToId: master.assignedToId,
    approvedById: master.approvedById,
    approvedAt: master.approvedAt,
    rejectionComment: master.rejectionComment,
    importedFrom: master.importedFrom,
    createdAt: master.createdAt,
    updatedAt: master.updatedAt,
    fields: master.fields.map(toFieldDto),
    allowedActions: getMasterAllowedActions(
      master.status,
      actor.role,
      actor.userId,
      master.assignedToId,
    ),
  };
}

function assertSadmin(actor: JwtAccessPayload) {
  if (actor.role !== Role.SADMIN) {
    throw AppError.forbidden("Only Super Admin can perform this action");
  }
}

function assertCanEditFields(master: MasterWithFields, actor: JwtAccessPayload) {
  if (master.status !== MasterStatus.DRAFT) {
    throw AppError.conflict("Fields can only be edited while master is DRAFT");
  }
  const isSadmin = actor.role === Role.SADMIN;
  const isAssignee = master.assignedToId === actor.userId;
  if (!isSadmin && !isAssignee) {
    throw AppError.forbidden("Only Super Admin or the assigned creator can edit fields");
  }
}

export async function createMaster(
  productId: string,
  body: CreateMasterBody,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<MasterDetailDto> {
  assertSadmin(actor);

  const product = await mastersRepo.findProductById(productId);
  if (!product) {
    throw AppError.notFound("Product");
  }

  if (body.mode === "assign") {
    const assignee = await mastersRepo.findUserById(body.assignedTo!);
    if (!assignee || assignee.deletedAt) {
      throw AppError.notFound("Assigned user");
    }
  }

  validateRequiredFields(body.fields);

  const maxRevision = await mastersRepo.aggregateMasterRevision(productId);
  const revisionNo = (maxRevision._max.revisionNo ?? 0) + 1;

  const isDirect = body.mode === "direct";
  const now = new Date();

  let supersededIds: string[] = [];

  const master = await prisma.$transaction(async (tx) => {
    const created = await mastersRepo.createMasterWithFields(
      {
        productId,
        revisionNo,
        status: isDirect ? MasterStatus.ACTIVE : MasterStatus.DRAFT,
        effectiveDate: body.effectiveDate,
        createdById: actor.userId,
        assignedToId: isDirect ? undefined : body.assignedTo,
        approvedById: isDirect ? actor.userId : undefined,
        approvedAt: isDirect ? now : undefined,
        fields: body.fields,
      },
      tx,
    );

    if (isDirect) {
      supersededIds = await mastersRepo.supersedeActiveMasters(productId, created.id, tx);
    }

    return created;
  });

  const actorUser = await getUserById(actor.userId);
  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.CREATE,
    entityType: AuditEntityType.MASTER,
    entityId: master.id,
    ipAddress,
  });

  if (!isDirect && body.assignedTo) {
    await auditLog({
      userId: actor.userId,
      userName: actorUser?.fullName,
      role: actor.role,
      department: actorUser?.department?.name,
      action: AuditAction.ASSIGN,
      entityType: AuditEntityType.MASTER,
      entityId: master.id,
      newValue: body.assignedTo,
      ipAddress,
    });

    await notify({
      recipients: { users: [body.assignedTo] },
      type: "MASTER_ASSIGNED",
      title: "Product Master assigned",
      message: `You have been assigned to complete Product Master revision ${revisionNo}.`,
      link: masterLink(master.id),
      excludeUserId: actor.userId,
    });
  }

  for (const supersededId of supersededIds) {
    await auditLog({
      userId: actor.userId,
      userName: actorUser?.fullName,
      role: actor.role,
      action: AuditAction.SUPERSEDE,
      entityType: AuditEntityType.MASTER,
      entityId: supersededId,
      ipAddress,
    });
  }

  return toMasterDetail(master, actor);
}

export async function getMasterDetail(
  masterId: string,
  actor: JwtAccessPayload,
): Promise<MasterDetailDto> {
  const master = await mastersRepo.findMasterWithFields(masterId);
  if (!master) {
    throw AppError.notFound("Product master");
  }
  return toMasterDetail(master, actor);
}

export async function patchMasterFields(
  masterId: string,
  body: PatchFieldsBody,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<MasterDetailDto> {
  const master = await mastersRepo.findMasterWithFields(masterId);
  if (!master) {
    throw AppError.notFound("Product master");
  }

  assertCanEditFields(master, actor);
  validateRequiredFields(body.fields);

  const updated = await mastersRepo.replaceMasterFields(masterId, body.fields);

  const actorUser = await getUserById(actor.userId);
  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.UPDATE,
    entityType: AuditEntityType.MASTER,
    entityId: masterId,
    fieldChanged: "fields",
    ipAddress,
  });

  return toMasterDetail(updated!, actor);
}

export async function approveMaster(
  masterId: string,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<MasterDetailDto> {
  assertSadmin(actor);

  const master = await mastersRepo.findMasterWithFields(masterId);
  if (!master) {
    throw AppError.notFound("Product master");
  }

  if (master.status !== MasterStatus.DRAFT) {
    throw AppError.illegalTransition("Only DRAFT masters can be approved");
  }

  if (master.assignedToId && master.assignedToId === actor.userId) {
    throw AppError.selfApproval("Approver cannot be the assignee who filled the master");
  }

  validateRequiredFields(master.fields);

  const now = new Date();

  let supersededIds: string[] = [];

  const updated = await prisma.$transaction(async (tx) => {
    supersededIds = await mastersRepo.supersedeActiveMasters(master.productId, masterId, tx);
    return mastersRepo.updateMaster(
      masterId,
      {
        status: MasterStatus.ACTIVE,
        approvedBy: { connect: { id: actor.userId } },
        approvedAt: now,
        effectiveDate: master.effectiveDate ?? now,
        rejectionComment: null,
      },
      tx,
    );
  });

  const actorUser = await getUserById(actor.userId);
  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.APPROVE,
    entityType: AuditEntityType.MASTER,
    entityId: masterId,
    fieldChanged: "status",
    oldValue: MasterStatus.DRAFT,
    newValue: MasterStatus.ACTIVE,
    ipAddress,
  });

  for (const supersededId of supersededIds) {
    await auditLog({
      userId: actor.userId,
      userName: actorUser?.fullName,
      role: actor.role,
      action: AuditAction.SUPERSEDE,
      entityType: AuditEntityType.MASTER,
      entityId: supersededId,
      ipAddress,
    });
  }

  return toMasterDetail(updated, actor);
}

export async function rejectMaster(
  masterId: string,
  body: RejectBody,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<MasterDetailDto> {
  assertSadmin(actor);

  const master = await mastersRepo.findMasterWithFields(masterId);
  if (!master) {
    throw AppError.notFound("Product master");
  }

  if (master.status !== MasterStatus.DRAFT) {
    throw AppError.illegalTransition("Only DRAFT masters can be rejected");
  }

  const updated = await mastersRepo.updateMaster(masterId, {
    rejectionComment: body.comment,
  });

  const actorUser = await getUserById(actor.userId);
  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.REJECT,
    entityType: AuditEntityType.MASTER,
    entityId: masterId,
    comment: body.comment,
    ipAddress,
  });

  if (master.assignedToId) {
    await notify({
      recipients: { users: [master.assignedToId] },
      type: "MASTER_REJECTED",
      title: "Product Master rejected",
      message: body.comment,
      link: masterLink(masterId),
      excludeUserId: actor.userId,
    });
  }

  return toMasterDetail(updated, actor);
}

export async function assignMaster(
  masterId: string,
  body: AssignBody,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<MasterDetailDto> {
  assertSadmin(actor);

  const master = await mastersRepo.findMasterWithFields(masterId);
  if (!master) {
    throw AppError.notFound("Product master");
  }

  if (master.status !== MasterStatus.DRAFT) {
    throw AppError.conflict("Only DRAFT masters can be reassigned");
  }

  const assignee = await mastersRepo.findUserById(body.assignedTo);
  if (!assignee || assignee.deletedAt) {
    throw AppError.notFound("Assigned user");
  }

  const updated = await mastersRepo.updateMaster(masterId, {
    assignedTo: { connect: { id: body.assignedTo } },
  });

  const actorUser = await getUserById(actor.userId);
  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.ASSIGN,
    entityType: AuditEntityType.MASTER,
    entityId: masterId,
    newValue: body.assignedTo,
    ipAddress,
  });

  await notify({
    recipients: { users: [body.assignedTo] },
    type: "MASTER_ASSIGNED",
    title: "Product Master assigned",
    message: `You have been assigned to complete Product Master revision ${master.revisionNo}.`,
    link: masterLink(masterId),
    excludeUserId: actor.userId,
  });

  return toMasterDetail(updated, actor);
}
