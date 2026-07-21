import { Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ok } from "../../lib/api-response";
import { AppError } from "../../lib/app-error";
import type { AuthenticatedRequest } from "../../types/authenticated-request";
import type { TransitionBody } from "../masters/masters.schema";
import {
  acknowledgeExpiredSection,
  acknowledgeOosSection,
  checkAwsSection,
  completeAwsSection,
  rejectCheckAwsSection,
} from "./aws-compliance.service";
import {
  getAwsSectionDetail,
  listAwsSections,
  patchAwsSection,
  patchAwsSectionByManager,
  previewAwsSection,
} from "./aws.service";
import {
  deleteSectionAttachment,
  listSectionAttachments,
  uploadSectionAttachment,
} from "./aws-attachments.service";
import * as awsRepo from "./aws.repository";
import {
  assertAnalystEditableStatus,
  assertEditableAwsDocument,
  assertSectionAssignee,
} from "./aws-guards";
import type {
  AcknowledgeExpiredBody,
  AcknowledgeOosBody,
  PatchAwsSectionBody,
  PatchAwsSectionByManagerBody,
  PreviewAwsSectionBody,
  RejectCheckBody,
  UploadAttachmentBody,
} from "./aws.schema";

export const listSections = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { awsDocId } = req.params;
  const result = await listAwsSections(awsDocId, req.user);
  res.json(ok(result));
});

export const getSectionById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const section = await getAwsSectionDetail(id, req.user);
  res.json(ok(section));
});

export const patchSection = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as PatchAwsSectionBody;
  const { id } = req.params;
  const updated = await patchAwsSection(id, body, req.body as Record<string, unknown>, req.user, req.ip);
  res.json(ok(updated));
});

export const patchSectionByManager = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as PatchAwsSectionByManagerBody;
  const { awsDocId, sectionId } = req.params;
  const updated = await patchAwsSectionByManager(
    awsDocId,
    sectionId,
    body,
    req.body as Record<string, unknown>,
    req.user,
    req.ip,
  );
  res.json(ok(updated));
});

export const previewSection = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as PreviewAwsSectionBody;
  const { id } = req.params;
  const preview = await previewAwsSection(id, body, req.user);
  res.json(ok(preview));
});

export const acknowledgeExpired = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as AcknowledgeExpiredBody;
  const { id } = req.params;
  const updated = await acknowledgeExpiredSection(id, body, req.user, req.ip);
  res.json(ok(updated));
});

export const acknowledgeOos = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as AcknowledgeOosBody;
  const { id } = req.params;
  const updated = await acknowledgeOosSection(id, body, req.user, req.ip);
  res.json(ok(updated));
});

export const completeSection = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const updated = await completeAwsSection(id, req.user, req.ip);
  res.json(ok(updated));
});

export const checkSection = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as TransitionBody;
  const { id } = req.params;
  const updated = await checkAwsSection(id, body, req.user, req.ip);
  res.json(ok(updated));
});

export const rejectCheckSection = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as RejectCheckBody;
  const { id } = req.params;
  const updated = await rejectCheckAwsSection(id, body, req.user, req.ip);
  res.json(ok(updated));
});

export const listAttachments = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const section = await awsRepo.findAwsSectionById(id);
  if (!section) throw AppError.notFound("AWS section");
  const attachments = await listSectionAttachments(id);
  res.json(ok(attachments));
});

export const uploadAttachment = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as UploadAttachmentBody;
  const { id } = req.params;
  const section = await awsRepo.findAwsSectionById(id);
  if (!section) throw AppError.notFound("AWS section");
  assertEditableAwsDocument(section);
  assertSectionAssignee(section, req.user);
  assertAnalystEditableStatus(section);
  const attachment = await uploadSectionAttachment(section, body);
  res.status(201).json(ok(attachment));
});

export const deleteAttachment = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id, attachmentId } = req.params;
  const section = await awsRepo.findAwsSectionById(id);
  if (!section) throw AppError.notFound("AWS section");
  assertEditableAwsDocument(section);
  assertSectionAssignee(section, req.user);
  assertAnalystEditableStatus(section);
  await deleteSectionAttachment(section, attachmentId);
  res.json(ok({ deleted: true }));
});
