import { FieldDataType, MasterStatus, Prisma } from "@prisma/client";
import { Db, prisma } from "../../lib/prisma-types";

export type MasterFieldInput = {
  fieldKey: string;
  label: string;
  value?: string | null;
  dataType: FieldDataType;
  sortOrder: number;
  isRequired?: boolean;
};

export async function findProductById(id: string, client: Db = prisma) {
  return client.product.findUnique({ where: { id } });
}

export async function aggregateMasterRevision(productId: string, client: Db = prisma) {
  return client.productMaster.aggregate({
    where: { productId },
    _max: { revisionNo: true },
  });
}

export async function findMasterById(masterId: string, client: Db = prisma) {
  return client.productMaster.findUnique({ where: { id: masterId } });
}

export async function findMasterWithFields(masterId: string, client: Db = prisma) {
  return client.productMaster.findUnique({
    where: { id: masterId },
    include: {
      fields: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function listMastersByProductId(productId: string, client: Db = prisma) {
  return client.productMaster.findMany({
    where: { productId },
    orderBy: { revisionNo: "desc" },
  });
}

export async function findActiveMasterForProduct(productId: string, client: Db = prisma) {
  return client.productMaster.findFirst({
    where: { productId, status: MasterStatus.ACTIVE },
  });
}

export async function createMasterWithFields(
  data: {
    productId: string;
    revisionNo: number;
    status: MasterStatus;
    effectiveDate?: Date;
    createdById: string;
    assignedToId?: string;
    approvedById?: string;
    approvedAt?: Date;
    fields: MasterFieldInput[];
  },
  client: Db = prisma,
) {
  return client.productMaster.create({
    data: {
      productId: data.productId,
      revisionNo: data.revisionNo,
      status: data.status,
      effectiveDate: data.effectiveDate,
      createdById: data.createdById,
      assignedToId: data.assignedToId,
      approvedById: data.approvedById,
      approvedAt: data.approvedAt,
      fields: {
        create: data.fields.map((f) => ({
          fieldKey: f.fieldKey,
          label: f.label,
          value: f.value ?? null,
          dataType: f.dataType,
          sortOrder: f.sortOrder,
          isRequired: f.isRequired ?? false,
        })),
      },
    },
    include: {
      fields: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function replaceMasterFields(
  masterId: string,
  fields: MasterFieldInput[],
  client: Db = prisma,
) {
  await client.productMasterField.deleteMany({ where: { productMasterId: masterId } });
  await client.productMasterField.createMany({
    data: fields.map((f) => ({
      productMasterId: masterId,
      fieldKey: f.fieldKey,
      label: f.label,
      value: f.value ?? null,
      dataType: f.dataType,
      sortOrder: f.sortOrder,
      isRequired: f.isRequired ?? false,
    })),
  });
  return findMasterWithFields(masterId, client);
}

export async function updateMaster(
  masterId: string,
  data: Prisma.ProductMasterUpdateInput,
  client: Db = prisma,
) {
  return client.productMaster.update({
    where: { id: masterId },
    data,
    include: {
      fields: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function supersedeActiveMasters(
  productId: string,
  exceptMasterId: string,
  client: Db = prisma,
): Promise<string[]> {
  const toSupersede = await client.productMaster.findMany({
    where: {
      productId,
      status: MasterStatus.ACTIVE,
      id: { not: exceptMasterId },
    },
    select: { id: true },
  });

  if (toSupersede.length === 0) {
    return [];
  }

  await client.productMaster.updateMany({
    where: {
      productId,
      status: MasterStatus.ACTIVE,
      id: { not: exceptMasterId },
    },
    data: { status: MasterStatus.SUPERSEDED },
  });

  return toSupersede.map((m) => m.id);
}

export async function findUserById(userId: string, client: Db = prisma) {
  return client.user.findUnique({ where: { id: userId } });
}
