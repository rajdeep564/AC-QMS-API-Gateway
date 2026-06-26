import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma-types";
import { AppError } from "../../lib/app-error";
import { JwtAccessPayload } from "../../types/auth.types";
import { AuditAction, AuditEntityType, log as auditLog } from "../../services/audit.service";
import { getAllowedActions } from "../../services/workflow-engine";
import { getUserById } from "../auth/auth.service";
import { CreateMasterBody } from "./masters.schema";
import { MasterDetailDto } from "./masters.types";
import * as mastersRepo from "./masters.repository";

function toMasterDetail(
  master: Prisma.ProductMasterGetPayload<{
    include: { testParameters: true; moaSections: true };
  }>,
  allowedActions: ReturnType<typeof getAllowedActions>,
): MasterDetailDto {
  return {
    id: master.id,
    productId: master.productId,
    revisionNo: master.revisionNo,
    status: master.status,
    effectiveDate: master.effectiveDate,
    createdById: master.createdById,
    submittedById: master.submittedById,
    submittedAt: master.submittedAt,
    qcApprovedById: master.qcApprovedById,
    qcApprovedAt: master.qcApprovedAt,
    qaSignedById: master.qaSignedById,
    qaSignedAt: master.qaSignedAt,
    rejectionComment: master.rejectionComment,
    createdAt: master.createdAt,
    updatedAt: master.updatedAt,
    testParameters: master.testParameters
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((tp) => ({
        id: tp.id,
        sortOrder: tp.sortOrder,
        testName: tp.testName,
        isMandatory: tp.isMandatory,
        resultType: tp.resultType,
        acceptanceCriteria: tp.acceptanceCriteria,
        minValue: tp.minValue?.toString() ?? null,
        maxValue: tp.maxValue?.toString() ?? null,
        operator: tp.operator,
        uom: tp.uom,
        departmentId: tp.departmentId,
        isOutsideLab: tp.isOutsideLab,
        calculationFormula: tp.calculationFormula,
        formulaVariables: tp.formulaVariables,
        instrumentsRequired: tp.instrumentsRequired,
        reagentsRequired: tp.reagentsRequired,
      })),
    moaSections: master.moaSections.map((ms) => ({
      id: ms.id,
      testParameterId: ms.testParameterId,
      pharmacopoeia: ms.pharmacopoeia,
      samplePreparation: ms.samplePreparation,
      standardPreparation: ms.standardPreparation,
      blankPreparation: ms.blankPreparation,
      conclusionTemplate: ms.conclusionTemplate,
      additionalNotes: ms.additionalNotes,
    })),
    allowedActions,
  };
}

export async function createMaster(
  productId: string,
  body: CreateMasterBody,
  actor: JwtAccessPayload,
  ipAddress?: string,
): Promise<MasterDetailDto> {
  const product = await mastersRepo.findProductById(productId);
  if (!product) {
    throw AppError.notFound("Product");
  }

  const maxRevision = await mastersRepo.aggregateMasterRevision(productId);
  const revisionNo = (maxRevision._max.revisionNo ?? 0) + 1;

  const master = await prisma.$transaction(async (tx) => {
    const created = await mastersRepo.createMaster(
      {
        productId,
        revisionNo,
        effectiveDate: body.effectiveDate,
        createdById: actor.userId,
      },
      tx,
    );

    const testParameterIds: string[] = [];

    for (const tp of body.testParameters) {
      const createdTp = await mastersRepo.createTestParameter(
        {
          productMaster: { connect: { id: created.id } },
          sortOrder: tp.sortOrder,
          testName: tp.testName,
          isMandatory: tp.isMandatory,
          resultType: tp.resultType,
          acceptanceCriteria: tp.acceptanceCriteria,
          minValue: tp.minValue,
          maxValue: tp.maxValue,
          operator: tp.operator,
          uom: tp.uom,
          ...(tp.departmentId
            ? { department: { connect: { id: tp.departmentId } } }
            : {}),
          isOutsideLab: tp.isOutsideLab ?? false,
          calculationFormula: tp.calculationFormula,
          formulaVariables: tp.formulaVariables as Prisma.InputJsonValue | undefined,
          instrumentsRequired: tp.instrumentsRequired ?? [],
          reagentsRequired: tp.reagentsRequired ?? [],
        },
        tx,
      );
      testParameterIds.push(createdTp.id);
    }

    if (body.moaSections) {
      for (const moa of body.moaSections) {
        const testParameterId = testParameterIds[moa.testParameterIndex];
        if (!testParameterId) {
          throw AppError.validation(`Invalid testParameterIndex: ${moa.testParameterIndex}`);
        }

        await mastersRepo.createMoaSection(
          {
            productMaster: { connect: { id: created.id } },
            testParameter: { connect: { id: testParameterId } },
            pharmacopoeia: moa.pharmacopoeia,
            samplePreparation: moa.samplePreparation,
            standardPreparation: moa.standardPreparation,
            blankPreparation: moa.blankPreparation,
            conclusionTemplate: moa.conclusionTemplate,
            additionalNotes: moa.additionalNotes,
          },
          tx,
        );
      }
    }

    return mastersRepo.findMasterWithRelations(created.id, tx);
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

  const allowedActions = getAllowedActions(
    "PRODUCT_MASTER",
    master.status,
    actor.role,
    actor.userId,
    {
      createdById: master.createdById,
      submittedById: master.submittedById,
      qcApprovedById: master.qcApprovedById,
    },
  );

  return toMasterDetail(master, allowedActions);
}

export async function getMasterDetail(
  masterId: string,
  actor: JwtAccessPayload,
): Promise<MasterDetailDto> {
  const exists = await mastersRepo.findMasterById(masterId);
  if (!exists) {
    throw AppError.notFound("Product master");
  }

  const master = await mastersRepo.findMasterWithRelations(masterId);

  const allowedActions = getAllowedActions(
    "PRODUCT_MASTER",
    master.status,
    actor.role,
    actor.userId,
    {
      createdById: master.createdById,
      submittedById: master.submittedById,
      qcApprovedById: master.qcApprovedById,
    },
  );

  return toMasterDetail(master, allowedActions);
}

export async function getMasterById(masterId: string) {
  const master = await mastersRepo.findMasterById(masterId, prisma, {
    testParameters: true,
    moaSections: true,
  });

  if (!master) {
    throw AppError.notFound("Product master");
  }

  return master;
}
