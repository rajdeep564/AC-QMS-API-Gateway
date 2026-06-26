import { ProductStatus, Role } from "@prisma/client";

export interface ProductDto {
  id: string;
  name: string;
  code: string;
  chemicalName: string | null;
  chemicalFormula: string | null;
  molecularWeight: string | null;
  molecularWeightUom: string | null;
  regulatoryRefs: string[];
  originSource: string | null;
  shelfLifeMonths: number;
  storageConditions: string | null;
  status: ProductStatus;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductMasterSummaryDto {
  id: string;
  revisionNo: number;
  status: string;
  effectiveDate: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}
