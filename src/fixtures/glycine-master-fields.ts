import { FieldDataType } from "@prisma/client";

export type MasterFieldSeed = {
  fieldKey: string;
  label: string;
  value: string;
  dataType: FieldDataType;
  sortOrder: number;
  isRequired: boolean;
};

export const GLYCINE_MASTER_FIELDS: MasterFieldSeed[] = [
  { fieldKey: "product_code", label: "Product Code", value: "FG00038", dataType: FieldDataType.TEXT, sortOrder: 1, isRequired: true },
  { fieldKey: "product_name", label: "Product Name", value: "Glycine IP", dataType: FieldDataType.TEXT, sortOrder: 2, isRequired: true },
  { fieldKey: "expiry_month", label: "Expiry Month", value: "60", dataType: FieldDataType.NUMBER, sortOrder: 3, isRequired: false },
  { fieldKey: "product_grade", label: "Product Grade", value: "IP", dataType: FieldDataType.TEXT, sortOrder: 4, isRequired: false },
  { fieldKey: "category", label: "Category", value: "Amino Acid", dataType: FieldDataType.TEXT, sortOrder: 5, isRequired: false },
  { fieldKey: "hsn_number", label: "HSN Number", value: "", dataType: FieldDataType.TEXT, sortOrder: 6, isRequired: false },
  { fieldKey: "molecular_formula", label: "Molecular Formula", value: "C2H5NO2", dataType: FieldDataType.TEXT, sortOrder: 7, isRequired: false },
  { fieldKey: "primary_packing", label: "Primary Packing", value: "400 GSM LDPE polybag/liner", dataType: FieldDataType.TEXT, sortOrder: 8, isRequired: false },
  { fieldKey: "shelf_life", label: "Shelf Life", value: "60 months", dataType: FieldDataType.TEXT, sortOrder: 9, isRequired: false },
  { fieldKey: "cas_no", label: "CAS No", value: "56-40-6", dataType: FieldDataType.TEXT, sortOrder: 10, isRequired: false },
  { fieldKey: "secondary_packing_1", label: "Secondary Packing 1", value: "HDPE drums", dataType: FieldDataType.TEXT, sortOrder: 11, isRequired: false },
  { fieldKey: "secondary_packing_2", label: "Secondary Packing 2", value: "Paper HDPE bags", dataType: FieldDataType.TEXT, sortOrder: 12, isRequired: false },
  { fieldKey: "secondary_packing_3", label: "Secondary Packing 3", value: "", dataType: FieldDataType.TEXT, sortOrder: 13, isRequired: false },
  { fieldKey: "mother_product", label: "Mother Product", value: "", dataType: FieldDataType.TEXT, sortOrder: 14, isRequired: false },
  { fieldKey: "composition", label: "Composition", value: "100 %", dataType: FieldDataType.TEXT, sortOrder: 15, isRequired: false },
  { fieldKey: "iupac_name", label: "IUPAC Name", value: "2-aminoethanoic acid", dataType: FieldDataType.TEXT, sortOrder: 16, isRequired: false },
  { fieldKey: "ld50_value", label: "LD50 Value", value: "", dataType: FieldDataType.TEXT, sortOrder: 17, isRequired: false },
  { fieldKey: "route_of_synthesis", label: "Route of Synthesis", value: "Chemical synthesis", dataType: FieldDataType.TEXT, sortOrder: 18, isRequired: false },
];
