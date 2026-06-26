import { Prisma, TemplateStatus, VariantType } from "@prisma/client";
import { Db, prisma } from "../../lib/prisma-types";

export async function findProductById(id: string, client: Db = prisma) {
  return client.product.findUnique({ where: { id } });
}

export async function findProductMasterForProduct(
  masterId: string,
  productId: string,
  client: Db = prisma,
) {
  return client.productMaster.findFirst({
    where: { id: masterId, productId },
    include: { testParameters: true },
  });
}

export async function findProductMasterById(masterId: string, client: Db = prisma) {
  return client.productMaster.findUnique({
    where: { id: masterId },
    include: { testParameters: true },
  });
}

export async function aggregateTemplateRevision(
  productId: string,
  variantType: VariantType,
  client: Db = prisma,
) {
  return client.specTemplate.aggregate({
    where: { productId, variantType },
    _max: { revisionNo: true },
  });
}

export async function countTemplatesForVariant(
  productId: string,
  variantType: VariantType,
  client: Db = prisma,
) {
  return client.specTemplate.count({
    where: { productId, variantType },
  });
}

export async function findManyTemplates(
  where: Prisma.SpecTemplateWhereInput,
  skip: number,
  take: number,
  client: Db = prisma,
) {
  return client.specTemplate.findMany({
    where,
    skip,
    take,
    orderBy: { createdAt: "desc" },
  });
}

export async function countTemplates(where: Prisma.SpecTemplateWhereInput, client: Db = prisma) {
  return client.specTemplate.count({ where });
}

export async function findTemplateById(
  templateId: string,
  client: Db = prisma,
  include?: Prisma.SpecTemplateInclude,
) {
  return client.specTemplate.findUnique({
    where: { id: templateId },
    include,
  });
}

export async function findTemplateWithTests(templateId: string, client: Db = prisma) {
  return client.specTemplate.findUnique({
    where: { id: templateId },
    include: { specTemplateTests: { include: { testParameter: true } } },
  });
}

export async function findTemplateWithTestsAndProduct(templateId: string, client: Db = prisma) {
  return client.specTemplate.findUnique({
    where: { id: templateId },
    include: { specTemplateTests: true, product: true },
  });
}

export async function createTemplate(
  data: Prisma.SpecTemplateCreateInput,
  client: Db = prisma,
) {
  return client.specTemplate.create({ data });
}

export async function updateTemplate(
  templateId: string,
  data: Prisma.SpecTemplateUpdateInput,
  client: Db = prisma,
  include?: Prisma.SpecTemplateInclude,
) {
  return client.specTemplate.update({
    where: { id: templateId },
    data,
    include,
  });
}

export async function deleteTemplateTests(specTemplateId: string, client: Db = prisma) {
  return client.specTemplateTest.deleteMany({ where: { specTemplateId } });
}

export async function createTemplateTest(
  data: Prisma.SpecTemplateTestCreateInput,
  client: Db = prisma,
) {
  return client.specTemplateTest.create({ data });
}

export async function findTemplateWithTestsOrThrow(templateId: string, client: Db = prisma) {
  return client.specTemplate.findUniqueOrThrow({
    where: { id: templateId },
    include: { specTemplateTests: { include: { testParameter: true } } },
  });
}

export async function countIncludedTemplateTests(specTemplateId: string, client: Db = prisma) {
  return client.specTemplateTest.count({
    where: { specTemplateId, isIncluded: true },
  });
}

export async function updateSpecTemplate(
  templateId: string,
  data: Prisma.SpecTemplateUpdateInput,
  client: Db = prisma,
) {
  return client.specTemplate.update({ where: { id: templateId }, data });
}

export async function findTemplateNo(templateId: string, client: Db = prisma) {
  return client.specTemplate.findUnique({
    where: { id: templateId },
    select: { templateNo: true },
  });
}

export async function countTemplatesByProductCode(productCode: string, client: Db = prisma) {
  return client.specTemplate.count({
    where: { product: { code: productCode } },
  });
}

export async function findTemplateByIdWithProduct(templateId: string, client: Db = prisma) {
  return client.specTemplate.findUnique({
    where: { id: templateId },
    include: { product: true },
  });
}
