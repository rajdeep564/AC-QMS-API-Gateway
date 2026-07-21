/**
 * Types mirroring AC-QMS-DOC-Module Pydantic schemas (see SOP_CONTRACT.md).
 * No domain mapping here — mappers produce these shapes.
 */

export type AcceptanceCriteriaDto = {
  type: "range" | "max" | "min" | "equals" | "text" | "nmt" | "nlt" | "between";
  min?: number | null;
  max?: number | null;
  value?: string | number | null;
  unit?: string | null;
  display?: string | null;
};

export type TestConfigDto = {
  name: string;
  procedure?: string | null;
  acceptance_criteria?: AcceptanceCriteriaDto | string | null;
  instruments?: string[];
  reagents?: string[];
  tables?: unknown[];
  sub_tests?: TestConfigDto[];
  section_no?: string | null;
};

export type ProductConfigDto = {
  product_code: string;
  product_name: string;
  reference?: string | null;
  molecular_weight?: string | null;
  chemical_formula?: string | null;
  specification_no?: string | null;
  moa_no?: string | null;
  protocol_no?: string | null;
  department?: string;
  tests?: TestConfigDto[];
  additional_tests?: TestConfigDto[];
  microbiological_tests?: TestConfigDto[];
  sop_sections?: unknown[];
  revision_history?: unknown[];
  metadata?: Record<string, unknown>;
};

export type ApprovalPersonDto = {
  name?: string | null;
  designation?: string | null;
  signature?: string | null;
  date?: string | null;
};

export type ApprovalBlockDto = {
  prepared_by?: ApprovalPersonDto;
  checked_by?: ApprovalPersonDto;
  approved_by?: ApprovalPersonDto;
};

export type StandingDocumentType = "moa" | "protocol" | "specification" | "sop" | "annexure";

export type InlineGenerateRequestDto = {
  document_type: StandingDocumentType;
  product: ProductConfigDto;
  document_no?: string | null;
  revision_no?: string;
  subject?: string | null;
  department?: string;
  effective_date?: string | null;
  review_date?: string | null;
  superseded_revision?: string | null;
  approval?: ApprovalBlockDto;
  revision_history?: unknown[];
  batch?: Record<string, unknown>;
  extra_context?: Record<string, unknown>;
};

export type PersonSignatureDto = ApprovalPersonDto;

export type ProductIdentityDto = {
  product_name: string;
  product_code?: string | null;
  reference?: string | null;
  specification_no?: string | null;
  moa_no?: string | null;
};

export type BatchIdentityDto = {
  batch_no: string;
  arn_no?: string | null;
  mfg_date?: string | null;
  exp_date?: string | null;
  batch_size?: string | null;
  quantity_sampled?: string | null;
  test_request_no?: string | null;
  received_date?: string | null;
  testing_date?: string | null;
  completion_date?: string | null;
};

export type DocumentApprovalDto = {
  prepared_by: PersonSignatureDto;
  checked_by: PersonSignatureDto;
  approved_by: PersonSignatureDto;
};

export type AwsSectionRenderDto = {
  sort_order: number;
  section_no?: string | null;
  test_name: string;
  limits_display: string;
  procedure_text?: string | null;
  readings_display?: string | null;
  calculated_result?: string | null;
  result_display: string;
  conclusion_display: string;
  is_oos?: boolean;
  oos_acknowledged?: boolean;
  oos_ack_comment?: string | null;
  instrument_display?: string | null;
  reagent_display?: string | null;
  instrument_expired_ack?: boolean;
  reagent_expired_ack?: boolean;
  expiry_ack_comment?: string | null;
  analyst?: PersonSignatureDto;
  checker?: PersonSignatureDto;
};

export type AwsRenderInputDto = {
  document_no: string;
  document_no_label?: string;
  document_type_label?: string;
  revision_no?: string;
  effective_date?: string | null;
  review_date?: string | null;
  superseded_revision?: string | null;
  company_name?: string;
  department?: string;
  product: ProductIdentityDto;
  batch: BatchIdentityDto;
  sections: AwsSectionRenderDto[];
  summary_rows?: unknown[] | null;
  compliance_note?: string | null;
  approval: DocumentApprovalDto;
  revision_history?: unknown[];
  logo_path?: string | null;
  metadata?: Record<string, unknown>;
};

export type CoaResultRowDto = {
  sort_order: number;
  test_name: string;
  result: string;
  acceptance_limits?: string | null;
  conclusion?: string | null;
};

export type CoaRenderInputDto = {
  document_no: string;
  document_no_label?: string;
  document_type_label?: string;
  revision_no?: string;
  effective_date?: string | null;
  review_date?: string | null;
  company_name?: string;
  product: ProductIdentityDto;
  batch: BatchIdentityDto;
  coa_results: CoaResultRowDto[];
  compliance_verdict: "COMPLIES" | "DOES_NOT_COMPLY";
  compliance_remark: string;
  approval: DocumentApprovalDto;
  revision_history?: unknown[];
  logo_path?: string | null;
};

export type HealthResponse = {
  status: string;
  app?: string;
};
