import { Role, SpecVariant, StandingDocStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma-types";
import { AppError } from "../../lib/app-error";
import { JwtAccessPayload } from "../../types/auth.types";
import { AuditAction, AuditEntityType, log as auditLog } from "../../services/audit.service";
import { getAllowedActions } from "../../services/workflow-engine";
import { transition } from "../../services/workflow-engine";
import { formatStandingMoaNo, formatStandingSpecNo } from "../../utils/standing-doc-number";
import { getUserById } from "../auth/auth.service";
import * as mastersRepo from "../masters/masters.repository";
import { CreateSpecBody, PatchSpecBody } from "./specs.schema";
import {
  MoaDocDto,
  MoaSectionDto,
  SpecDetailDto,
  SpecListItemDto,
  SpecTestDto,
} from "./specs.types";
import * as specsRepo from "./specs.repository";

type SpecWithDetails = NonNullable<Awaited<ReturnType<typeof specsRepo.findSpecWithDetails>>>;

function decimalToString(value: { toString(): string } | null): string | null {
  return value ? value.toString() : null;
}

function toTestDto(test: SpecWithDetails["specTests"][number]): SpecTestDto {
  return {
    id: test.id,
    sortOrder: test.sortOrder,
    testName: test.testName,
    resultType: test.resultType,
    operator: test.operator,
    minValue: decimalToString(test.minValue),
    maxValue: decimalToString(test.maxValue),
    uom: test.uom,
    acceptanceCriteria: test.acceptanceCriteria,
    formula: test.formula,
    formulaVariables: test.formulaVariables,
    isOptional: test.isOptional,
    isOutsideLab: test.isOutsideLab,
  };
}

function toMoaSectionDto(section: NonNullable<SpecWithDetails["moaDoc"]>["sections"][number]): MoaSectionDto {
  return {
    id: section.id,
    specTestId: section.specTestId,
    pharmacopoeia: section.pharmacopoeia,
    samplePreparation: section.samplePreparation,
    standardPreparation: section.standardPreparation,
    blankPreparation: section.blankPreparation,
    conclusionTemplate: section.conclusionTemplate,
    additionalNotes: section.additionalNotes,
  };
}

function toMoaDto(moa: SpecWithDetails["moaDoc"]): MoaDocDto | null {
  if (!moa) return null;
  return {
    id: moa.id,
    moaNo: moa.moaNo,
    revisionNo: moa.revisionNo,
    status: moa.status,
    sections: moa.sections.map(toMoaSectionDto),
  };
}

function toSpecDetail(spec: SpecWithDetails, actor: JwtAccessPayload): SpecDetailDto {
  return {
    id: spec.id,
    productId: spec.productId,
    variant: spec.variant,
    specNo: spec.specNo,
    revisionNo: spec.revisionNo,
    status: spec.status,
    supersedesId: spec.supersedesId,
    createdById: spec.createdById,
    submittedById: spec.submittedById,
    qcApprovedById: spec.qcApprovedById,
    qaSignedById: spec.qaSignedById,
    approvedAt: spec.approvedAt,
    effectiveDate: spec.effectiveDate,
    createdAt: spec.createdAt,
    tests: spec.specTests.map(toTestDto),
    moa: toMoaDto(spec.moaDoc),
    allowedActions: getAllowedActions(
      "STANDING_SPEC",
      spec.status as Parameters<typeof getAllowedActions>[1],
      actor.role,
      actor.userId,
      {
        createdById: spec.createdById,
        submittedById: spec.submittedById,
        qcApprovedById: spec.qcApprovedById,
      },
    ),
  };
}

async function getProductCodeFromActiveMaster(productId: string): Promise<string> {
  const master = await mastersRepo.findActiveMasterForProduct(productId);
  if (!master) {
    throw AppError.conflict("An ACTIVE Product Master is required before authoring a SPEC");
  }
  const masterWithFields = await mastersRepo.findMasterWithFields(master.id);
  const productCode = masterWithFields?.fields.find((f) => f.fieldKey === "product_code")?.value;
  if (!productCode) {
    throw AppError.conflict("ACTIVE master is missing product_code field");
  }
  return productCode;
}

async function assertNoInFlightRevision(productId: string, variant: SpecVariant) {
  const inFlight = await specsRepo.findInFlightRevision(productId, variant);
  if (inFlight) {
    throw AppError.conflict("A revision is already in progress for this product and variant");
  }
}

export async function listSpecsForProduct(productId: string): Promise<SpecListItemDto[]> {
  const product = await mastersRepo.findProductById(productId);
  if (!product) {
    throw AppError.notFound("Product");
  }

  const specs = await specsRepo.listSpecsByProduct(productId);
  return specs.map((s) => ({
    id: s.id,
    productId: s.productId,
    variant: s.variant,
    specNo: s.specNo,
    revisionNo: s.revisionNo,
    status: s.status,
    createdById: s.createdById,
    approvedAt: s.approvedAt,
    effectiveDate: s.effectiveDate,
    createdAt: s.createdAt,
    hasMoa: Boolean(s.moaDoc),
  }));
}

export async function createSpec(
  productId: string,
  body: CreateSpecBody,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<SpecDetailDto> {
  if (actor.role !== Role.QC_EXEC) {
    throw AppError.forbidden("Only QC Executive can author a standing SPEC");
  }

  const product = await mastersRepo.findProductById(productId);
  if (!product) {
    throw AppError.notFound("Product");
  }

  const activeMaster = await mastersRepo.findActiveMasterForProduct(productId);
  if (!activeMaster) {
    throw AppError.conflict("An ACTIVE Product Master is required before authoring a SPEC");
  }

  await assertNoInFlightRevision(productId, body.variant);

  const batchReady = await specsRepo.findBatchReadySpec(productId, body.variant);
  if (batchReady) {
    throw AppError.conflict("A signed SPEC already exists — use revise to create a new revision");
  }

  const existing = await specsRepo.aggregateRevisionNo(productId, body.variant);
  if ((existing._max.revisionNo ?? 0) > 0) {
    throw AppError.conflict("A SPEC already exists for this product — use revise after signing");
  }

  const revisionNo = 1;
  const productCode = await getProductCodeFromActiveMaster(productId);
  const specNo = body.specNo ?? formatStandingSpecNo(productCode, revisionNo);
  const moaNo = formatStandingMoaNo(productCode, revisionNo);

  const spec = await prisma.$transaction(async (tx) => {
    return specsRepo.createSpecWithMoaPair(
      {
        productId,
        variant: body.variant,
        specNo,
        moaNo,
        revisionNo,
        createdById: actor.userId,
        effectiveDate: body.effectiveDate,
        tests: body.tests as specsRepo.SpecTestInput[],
        moaSections: body.moaSections,
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
    action: AuditAction.CREATE,
    entityType: AuditEntityType.SPEC,
    entityId: spec!.id,
    docNo: specNo,
    ipAddress,
  });

  return toSpecDetail(spec!, actor);
}

export async function getSpecDetail(specId: string, actor: JwtAccessPayload): Promise<SpecDetailDto> {
  const spec = await specsRepo.findSpecWithDetails(specId);
  if (!spec) {
    throw AppError.notFound("Standing SPEC");
  }
  return toSpecDetail(spec, actor);
}

export async function patchSpec(
  specId: string,
  body: PatchSpecBody,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<SpecDetailDto> {
  const spec = await specsRepo.findSpecWithDetails(specId);
  if (!spec) {
    throw AppError.notFound("Standing SPEC");
  }

  if (spec.status !== StandingDocStatus.DRAFT) {
    throw AppError.conflict("SPEC can only be edited while DRAFT");
  }

  if (actor.role !== Role.QC_EXEC || spec.createdById !== actor.userId) {
    throw AppError.forbidden("Only the authoring QC Executive can edit this SPEC");
  }

  const updated = await specsRepo.replaceSpecContent(
    specId,
    body.tests as specsRepo.SpecTestInput[],
    body.moaSections,
  );

  if (body.effectiveDate) {
    await prisma.spec.update({
      where: { id: specId },
      data: { effectiveDate: body.effectiveDate },
    });
  }

  const refreshed = await specsRepo.findSpecWithDetails(specId);

  const actorUser = await getUserById(actor.userId);
  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.UPDATE,
    entityType: AuditEntityType.SPEC,
    entityId: specId,
    ipAddress,
  });

  return toSpecDetail(refreshed!, actor);
}

export async function submitSpec(
  specId: string,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<SpecDetailDto> {
  const updated = await transition({
    entityType: "STANDING_SPEC",
    entityId: specId,
    action: "SUBMIT",
    actor,
    ipAddress,
  });
  return toSpecDetail(updated as SpecWithDetails, actor);
}

export async function approveSpec(
  specId: string,
  password: string,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<SpecDetailDto> {
  const updated = await transition({
    entityType: "STANDING_SPEC",
    entityId: specId,
    action: "APPROVE",
    actor,
    password,
    ipAddress,
  });
  return toSpecDetail(updated as SpecWithDetails, actor);
}

export async function signSpec(
  specId: string,
  password: string,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<SpecDetailDto> {
  const updated = await transition({
    entityType: "STANDING_SPEC",
    entityId: specId,
    action: "SIGN",
    actor,
    password,
    ipAddress,
  });
  return toSpecDetail(updated as SpecWithDetails, actor);
}

export async function rejectSpec(
  specId: string,
  comment: string,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<SpecDetailDto> {
  const updated = await transition({
    entityType: "STANDING_SPEC",
    entityId: specId,
    action: "REJECT",
    actor,
    comment,
    ipAddress,
  });
  return toSpecDetail(updated as SpecWithDetails, actor);
}

export async function reviseSpec(
  specId: string,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<SpecDetailDto> {
  if (actor.role !== Role.QC_EXEC) {
    throw AppError.forbidden("Only QC Executive can revise a standing SPEC");
  }

  const source = await specsRepo.findSpecWithDetails(specId);
  if (!source) {
    throw AppError.notFound("Standing SPEC");
  }

  if (source.status !== StandingDocStatus.QA_SIGNED) {
    throw AppError.conflict("Only a QA_SIGNED SPEC can be revised");
  }

  await assertNoInFlightRevision(source.productId, source.variant);

  const productCode = await getProductCodeFromActiveMaster(source.productId);
  const newRevisionNo = source.revisionNo + 1;
  const specNo = formatStandingSpecNo(productCode, newRevisionNo);
  const moaNo = formatStandingMoaNo(productCode, newRevisionNo);

  const newSpec = await prisma.$transaction(async (tx) => {
    return specsRepo.copySpecRevision(source.id, actor.userId, specNo, moaNo, tx);
  });

  const actorUser = await getUserById(actor.userId);
  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.REVISE,
    entityType: AuditEntityType.SPEC,
    entityId: newSpec!.id,
    docNo: specNo,
    oldValue: source.id,
    ipAddress,
  });

  return toSpecDetail(newSpec!, actor);
}

export { findBatchReadySpec } from "./specs.repository";
