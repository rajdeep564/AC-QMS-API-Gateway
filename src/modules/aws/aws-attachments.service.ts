import fs from "fs/promises";
import path from "path";
import { FileType } from "@prisma/client";
import { prisma } from "../../lib/prisma-types";
import { AppError } from "../../lib/app-error";
import {
  mimeTypeFromFileName,
  parseAttachmentFileName,
  sectionAttachmentPathPrefix,
} from "./aws-field-config";
import { AwsAttachmentDto } from "./aws.types";
import type { AwsSectionDetail } from "./aws.repository";

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

export async function listSectionAttachments(sectionId: string): Promise<AwsAttachmentDto[]> {
  const prefix = sectionAttachmentPathPrefix(sectionId);
  const rows = await prisma.fileAttachment.findMany({
    where: { filePath: { startsWith: prefix } },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    fileName: parseAttachmentFileName(row.filePath),
    mimeType: mimeTypeFromFileName(parseAttachmentFileName(row.filePath)),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function countSectionAttachments(sectionId: string): Promise<number> {
  const prefix = sectionAttachmentPathPrefix(sectionId);
  return prisma.fileAttachment.count({
    where: { filePath: { startsWith: prefix } },
  });
}

export async function uploadSectionAttachment(
  section: AwsSectionDetail,
  input: { fileName: string; mimeType: string; contentBase64: string },
): Promise<AwsAttachmentDto> {
  const mime = input.mimeType.toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    throw AppError.validation("Only PDF, JPG, and PNG files are allowed");
  }

  const buffer = Buffer.from(input.contentBase64, "base64");
  if (buffer.length === 0) {
    throw AppError.validation("File content is empty");
  }
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw AppError.validation("File exceeds maximum size of 10 MB");
  }

  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storedName = `${Date.now()}-${safeName}`;
  const relativePath = `${sectionAttachmentPathPrefix(section.id)}${storedName}`;
  const absolutePath = path.join(UPLOAD_ROOT, relativePath);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);

  const row = await prisma.fileAttachment.create({
    data: {
      batchDocumentId: section.batchDocumentId,
      fileType: FileType.READING_ATTACHMENT,
      filePath: relativePath,
      generatedBy: "aws-section-upload",
    },
  });

  return {
    id: row.id,
    fileName: safeName,
    mimeType: mime,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function deleteSectionAttachment(
  section: AwsSectionDetail,
  attachmentId: string,
): Promise<void> {
  const prefix = sectionAttachmentPathPrefix(section.id);
  const row = await prisma.fileAttachment.findFirst({
    where: { id: attachmentId, filePath: { startsWith: prefix } },
  });
  if (!row) {
    throw AppError.notFound("Attachment");
  }

  const absolutePath = path.join(UPLOAD_ROOT, row.filePath);
  await prisma.fileAttachment.delete({ where: { id: row.id } });
  try {
    await fs.unlink(absolutePath);
  } catch {
    // File may already be removed from disk.
  }
}
