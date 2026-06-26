import {
  MasterStatus,
  Prisma,
  TemplateStatus,
  VariantType,
} from "@prisma/client";
import { prisma } from "../../lib/prisma-types";
import { AppError } from "../../lib/app-error";
import { JwtAccessPayload } from "../../types/auth.types";
import { parsePagination } from "../../utils/pagination";
import { generateTemplateNo } from "../../utils/doc-number";
import { AuditAction, AuditEntityType, log as auditLog } from "../../services/audit.service";
import { getAllowedActions } from "../../services/workflow-engine";
import { getUserById } from "../auth/auth.service";
import {
  CopySpecTemplateBody,
  CreateSpecTemplateBody,
  ListSpecTemplatesQuery,
  PatchSpecTemplateBody,
} from "./spec-templates.schema";
import { SpecTemplateDetailDto, SpecTemplateListItemDto } from "./spec-templates.types";
import * as specTemplatesRepo from "./spec-templates.repository";

function toListItem(
  template: Prisma.SpecTemplateGetPayload<object>,
): SpecTemplateListItemDto {
  return {
    id: template.id,
    templateNo: template.templateNo,
    variantType: template.variantType,
    customerName: template.customerName,
    revisionNo: template.revisionNo,
    status: template.status,
    sourceMasterId: template.sourceMasterId,
    copiedFromTemplateId: template.copiedFromTemplateId,
    createdById: template.createdById,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

function toDetail(
  template: Prisma.SpecTemplateGetPayload<{
    include: { specTemplateTests: { include: { testParameter: true } } };
  }>,
  allowedActions: ReturnType<typeof getAllowedActions>,
): SpecTemplateDetailDto {
  return {
    id: template.id,
    productId: template.productId,
    sourceMasterId: template.sourceMasterId,
    templateNo: template.templateNo,
    variantType: template.variantType,
    customerName: template.customerName,
    copiedFromTemplateId: template.copiedFromTemplateId,
    revisionNo: template.revisionNo,
    status: template.status,
    effectiveDate: template.effectiveDate,
    createdById: template.createdById,
    submittedById: template.submittedById,
    submittedAt: template.submittedAt,
    qcApprovedById: template.qcApprovedById,
    qcApprovedAt: template.qcApprovedAt,
    qaSignedById: template.qaSignedById,
    qaSignedAt: template.qaSignedAt,
    rejectionComment: template.rejectionComment,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    tests: template.specTemplateTests
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({
        id: t.id,
        testParameterId: t.testParameterId,
        sortOrder: t.sortOrder,
        isIncluded: t.isIncluded,
        isOptional: t.isOptional,
        overrideMinValue: t.overrideMinValue?.toString() ?? null,
        overrideMaxValue: t.overrideMaxValue?.toString() ?? null,
        overrideAcceptance: t.overrideAcceptance,
        testParameter: {
          id: t.testParameter.id,
          testName: t.testParameter.testName,
          resultType: t.testParameter.resultType,
          isMandatory: t.testParameter.isMandatory,
        },
      })),
    allowedActions,
  };
}

function validateTestsBelongToMaster(
  testParameterIds: string[],
  masterTestIds: Set<string>,
): void {
  for (const id of testParameterIds) {
    if (!masterTestIds.has(id)) {
      throw AppError.testNotInMaster(`Test parameter ${id} does not belong to source master`);
    }
  }
}

export async function listForProduct(productId: string, query: ListSpecTemplatesQuery) {
  const product = await specTemplatesRepo.findProductById(productId);
  if (!product) {
    throw AppError.notFound("Product");
  }

  const { page, limit, skip, take } = parsePagination(query as Record<string, unknown>);

  const where: Prisma.SpecTemplateWhereInput = { productId };

  if (query.variant) {
    where.variantType = query.variant;
  }
  if (query.status) {
    where.status = query.status;
  }
  if (query.customer) {
    where.customerName = { contains: query.customer, mode: "insensitive" };
  }

  const [items, total] = await Promise.all([
    specTemplatesRepo.findManyTemplates(where, skip, take),
    specTemplatesRepo.countTemplates(where),
  ]);

  return {
    items: items.map(toListItem),
    total,
    page,
    limit,
  };
}

export async function createFromMaster(
  productId: string,
  body: CreateSpecTemplateBody,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<SpecTemplateDetailDto> {
  const product = await specTemplatesRepo.findProductById(productId);
  if (!product) {
    throw AppError.notFound("Product");
  }

  const sourceMaster = await specTemplatesRepo.findProductMasterForProduct(
    body.sourceMasterId,
    productId,
  );

  if (!sourceMaster) {
    throw AppError.notFound("Source master");
  }

  if (sourceMaster.status !== MasterStatus.QA_SIGNED) {
    throw AppError.masterNotSigned();
  }

  const masterTestIds = new Set(sourceMaster.testParameters.map((tp) => tp.id));
  validateTestsBelongToMaster(
    body.tests.map((t) => t.testParameterId),
    masterTestIds,
  );

  const maxRevision = await specTemplatesRepo.aggregateTemplateRevision(
    productId,
    body.variantType,
  );
  const revisionNo = (maxRevision._max.revisionNo ?? 0) + 1;
  const templateNo = await generateTemplateNo(product.code, body.variantType);

  const template = await prisma.$transaction(async (tx) => {
    const created = await specTemplatesRepo.createTemplate(
      {
        product: { connect: { id: productId } },
        sourceMaster: { connect: { id: body.sourceMasterId } },
        templateNo,
        variantType: body.variantType,
        customerName: body.variantType === VariantType.CUSTOMER ? body.customerName : null,
        revisionNo,
        status: TemplateStatus.DRAFT,
        createdBy: { connect: { id: actor.userId } },
      },
      tx,
    );

    for (const test of body.tests) {
      await specTemplatesRepo.createTemplateTest(
        {
          specTemplate: { connect: { id: created.id } },
          testParameter: { connect: { id: test.testParameterId } },
          sortOrder: test.sortOrder,
          isIncluded: test.isIncluded ?? true,
          isOptional: test.isOptional ?? false,
          overrideMinValue: test.overrideMinValue,
          overrideMaxValue: test.overrideMaxValue,
          overrideAcceptance: test.overrideAcceptance,
        },
        tx,
      );
    }

    return specTemplatesRepo.findTemplateWithTestsOrThrow(created.id, tx);
  });

  const actorUser = await getUserById(actor.userId);
  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.CREATE,
    entityType: AuditEntityType.TEMPLATE,
    entityId: template.id,
    docNo: template.templateNo,
    ipAddress,
  });

  const allowedActions = getAllowedActions(
    "SPEC_TEMPLATE",
    template.status,
    actor.role,
    actor.userId,
    {
      createdById: template.createdById,
      submittedById: template.submittedById,
      qcApprovedById: template.qcApprovedById,
    },
  );

  return toDetail(template, allowedActions);
}

export async function copyTemplate(
  sourceId: string,
  body: CopySpecTemplateBody,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<SpecTemplateDetailDto> {
  const source = await specTemplatesRepo.findTemplateWithTestsAndProduct(sourceId);

  if (!source) {
    throw AppError.notFound("Spec template");
  }

  const maxRevision = await specTemplatesRepo.aggregateTemplateRevision(
    source.productId,
    VariantType.CUSTOMER,
  );
  const revisionNo = (maxRevision._max.revisionNo ?? 0) + 1;
  const templateNo = await generateTemplateNo(source.product.code, VariantType.CUSTOMER);

  const template = await prisma.$transaction(async (tx) => {
    const created = await specTemplatesRepo.createTemplate(
      {
        product: { connect: { id: source.productId } },
        sourceMaster: { connect: { id: source.sourceMasterId } },
        templateNo,
        variantType: VariantType.CUSTOMER,
        customerName: body.customerName,
        copiedFromTemplate: { connect: { id: source.id } },
        revisionNo,
        status: TemplateStatus.DRAFT,
        createdBy: { connect: { id: actor.userId } },
      },
      tx,
    );

    for (const test of source.specTemplateTests) {
      await specTemplatesRepo.createTemplateTest(
        {
          specTemplate: { connect: { id: created.id } },
          testParameter: { connect: { id: test.testParameterId } },
          sortOrder: test.sortOrder,
          isIncluded: test.isIncluded,
          isOptional: test.isOptional,
          overrideMinValue: test.overrideMinValue,
          overrideMaxValue: test.overrideMaxValue,
          overrideAcceptance: test.overrideAcceptance,
        },
        tx,
      );
    }

    return specTemplatesRepo.findTemplateWithTestsOrThrow(created.id, tx);
  });

  const actorUser = await getUserById(actor.userId);
  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.CREATE,
    entityType: AuditEntityType.TEMPLATE,
    entityId: template.id,
    docNo: template.templateNo,
    comment: `Copied from ${source.templateNo}`,
    ipAddress,
  });

  const allowedActions = getAllowedActions(
    "SPEC_TEMPLATE",
    template.status,
    actor.role,
    actor.userId,
    {
      createdById: template.createdById,
      submittedById: template.submittedById,
      qcApprovedById: template.qcApprovedById,
    },
  );

  return toDetail(template, allowedActions);
}

export async function getDetail(
  templateId: string,
  actor: JwtAccessPayload,
): Promise<SpecTemplateDetailDto> {
  const template = await specTemplatesRepo.findTemplateWithTests(templateId);

  if (!template) {
    throw AppError.notFound("Spec template");
  }

  const allowedActions = getAllowedActions(
    "SPEC_TEMPLATE",
    template.status,
    actor.role,
    actor.userId,
    {
      createdById: template.createdById,
      submittedById: template.submittedById,
      qcApprovedById: template.qcApprovedById,
    },
  );

  return toDetail(template, allowedActions);
}

export async function updateTemplate(
  templateId: string,
  body: PatchSpecTemplateBody,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<SpecTemplateDetailDto> {
  const existing = await specTemplatesRepo.findTemplateWithTestsAndProduct(templateId);

  if (!existing) {
    throw AppError.notFound("Spec template");
  }

  if (existing.status !== TemplateStatus.DRAFT) {
    throw AppError.conflict("Template is not in DRAFT");
  }

  if (existing.createdById !== actor.userId) {
    throw AppError.forbidden("Only the creator can edit this template");
  }

  const nextVariant = body.variantType ?? existing.variantType;
  if (nextVariant === VariantType.CUSTOMER) {
    const name = body.customerName ?? existing.customerName;
    if (!name?.trim()) {
      throw AppError.validation("customerName is required for CUSTOMER variant");
    }
  }

  if (body.tests) {
    const sourceMaster = await specTemplatesRepo.findProductMasterById(existing.sourceMasterId);
    if (!sourceMaster) {
      throw AppError.notFound("Source master");
    }
    const masterTestIds = new Set(sourceMaster.testParameters.map((tp) => tp.id));
    validateTestsBelongToMaster(
      body.tests.map((t) => t.testParameterId),
      masterTestIds,
    );
  }

  const template = await prisma.$transaction(async (tx) => {
    if (body.tests) {
      await specTemplatesRepo.deleteTemplateTests(templateId, tx);
      for (const test of body.tests) {
        await specTemplatesRepo.createTemplateTest(
          {
            specTemplate: { connect: { id: templateId } },
            testParameter: { connect: { id: test.testParameterId } },
            sortOrder: test.sortOrder,
            isIncluded: test.isIncluded ?? true,
            isOptional: test.isOptional ?? false,
            overrideMinValue: test.overrideMinValue,
            overrideMaxValue: test.overrideMaxValue,
            overrideAcceptance: test.overrideAcceptance,
          },
          tx,
        );
      }
    }

    await specTemplatesRepo.updateTemplate(
      templateId,
      {
        variantType: body.variantType,
        customerName:
          nextVariant === VariantType.CUSTOMER
            ? (body.customerName ?? existing.customerName)
            : body.variantType === VariantType.GENERAL
              ? null
              : existing.customerName,
      },
      tx,
    );

    return specTemplatesRepo.findTemplateWithTestsOrThrow(templateId, tx);
  });

  const actorUser = await getUserById(actor.userId);
  await auditLog({
    userId: actor.userId,
    userName: actorUser?.fullName,
    role: actor.role,
    department: actorUser?.department?.name,
    action: AuditAction.UPDATE,
    entityType: AuditEntityType.TEMPLATE,
    entityId: template.id,
    docNo: template.templateNo,
    ipAddress,
  });

  const allowedActions = getAllowedActions(
    "SPEC_TEMPLATE",
    template.status,
    actor.role,
    actor.userId,
    {
      createdById: template.createdById,
      submittedById: template.submittedById,
      qcApprovedById: template.qcApprovedById,
    },
  );

  return toDetail(template, allowedActions);
}
