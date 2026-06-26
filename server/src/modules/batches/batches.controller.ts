import { Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ok, paginated } from "../../lib/api-response";
import { AuditAction, AuditEntityType, log as auditLog } from "../../services/audit.service";
import type { AuthenticatedRequest } from "../../types/authenticated-request";
import { getUserById } from "../auth/auth.service";
import type { CreateBatchBody, ListBatchesQuery } from "./batches.schema";
import {
  createBatch as createBatchService,
  getAssigneeName,
  getBatchById,
  getTemplateNo,
  listBatches,
} from "./batches.service";

export const list = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const query = req.query as unknown as ListBatchesQuery;
  const result = await listBatches(query);
  res.json(paginated(result.items, result.total, result.page, result.limit));
});

export const create = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as CreateBatchBody;
  const { userId, role } = req.user;
  const result = await createBatchService(body, req.user);

  const actor = await getUserById(userId);
  const assigneeName = body.assignedQcExecId
    ? await getAssigneeName(body.assignedQcExecId)
    : undefined;
  const templateNo = await getTemplateNo(body.specTemplateId);

  await auditLog({
    userId,
    userName: actor?.fullName,
    role,
    department: actor?.department?.name,
    action: AuditAction.CREATE,
    entityType: AuditEntityType.BATCH,
    entityId: result.batch.id,
    docNo: result.batch.arn,
    comment: `Template ${templateNo ?? body.specTemplateId}, assigned to ${assigneeName ?? body.assignedQcExecId}`,
    ipAddress: req.ip,
  });

  res.status(201).json(ok(result));
});

export const getById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const batch = await getBatchById(id);
  res.json(ok(batch));
});
