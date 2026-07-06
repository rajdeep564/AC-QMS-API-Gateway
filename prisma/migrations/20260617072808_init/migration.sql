-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SADMIN', 'QC_EXEC', 'QC_MGR', 'QA_EXEC', 'QA_MGR', 'MKT_EXEC');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "DeptName" AS ENUM ('QC', 'QA', 'MARKETING');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MasterStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'QC_APPROVED', 'QA_SIGNED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ResultType" AS ENUM ('QUALITATIVE', 'QUANTITATIVE');

-- CreateEnum
CREATE TYPE "Operator" AS ENUM ('NMT', 'NLT', 'BETWEEN');

-- CreateEnum
CREATE TYPE "VariantType" AS ENUM ('GENERAL', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'QC_APPROVED', 'QA_SIGNED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('SPEC', 'MOA', 'AWS', 'COA');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('PENDING', 'DRAFT', 'SUBMITTED', 'QC_APPROVED', 'QA_SIGNED', 'REJECTED', 'AUTO_GENERATED', 'ISSUED');

-- CreateEnum
CREATE TYPE "DocPhase" AS ENUM ('SPEC', 'MOA', 'AWS', 'COA', 'RELEASED');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('ACTIVE', 'RELEASED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "SectionStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "Conclusion" AS ENUM ('SATISFACTORY', 'NOT_SATISFACTORY', 'PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "InstrumentStatus" AS ENUM ('ACTIVE', 'UNDER_MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ReagentStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "CCClassification" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR');

-- CreateEnum
CREATE TYPE "CCStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'IMPACT_ASSESSMENT', 'APPROVED', 'IMPLEMENTING', 'EXTENDED', 'VERIFICATION', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "department_id" UUID,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "force_pwd_change" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "name" "DeptName" NOT NULL,
    "color_hex" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "chemical_name" TEXT,
    "chemical_formula" TEXT,
    "molecular_weight" DECIMAL(65,30),
    "molecular_weight_uom" TEXT,
    "regulatory_refs" TEXT[],
    "origin_source" TEXT,
    "shelf_life_months" INTEGER NOT NULL,
    "storage_conditions" TEXT,
    "status" "ProductStatus" NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_masters" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "status" "MasterStatus" NOT NULL,
    "effective_date" DATE,
    "supersedes_id" UUID,
    "created_by" UUID NOT NULL,
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ,
    "qc_approved_by" UUID,
    "qc_approved_at" TIMESTAMPTZ,
    "qa_signed_by" UUID,
    "qa_signed_at" TIMESTAMPTZ,
    "rejection_comment" TEXT,
    "imported_from" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "product_masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_parameters" (
    "id" UUID NOT NULL,
    "product_master_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "test_name" TEXT NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL,
    "result_type" "ResultType" NOT NULL,
    "acceptance_criteria" TEXT,
    "min_value" DECIMAL(65,30),
    "max_value" DECIMAL(65,30),
    "operator" "Operator",
    "uom" TEXT,
    "department_id" UUID,
    "is_outside_lab" BOOLEAN NOT NULL DEFAULT false,
    "calculation_formula" TEXT,
    "formula_variables" JSONB,
    "instruments_required" TEXT[],
    "reagents_required" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moa_sections" (
    "id" UUID NOT NULL,
    "product_master_id" UUID NOT NULL,
    "test_parameter_id" UUID NOT NULL,
    "pharmacopoeia" TEXT,
    "sample_preparation" TEXT,
    "standard_preparation" TEXT,
    "blank_preparation" TEXT,
    "conclusion_template" TEXT,
    "additional_notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moa_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spec_templates" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "source_master_id" UUID NOT NULL,
    "template_no" TEXT NOT NULL,
    "variant_type" "VariantType" NOT NULL,
    "customer_name" TEXT,
    "copied_from_template_id" UUID,
    "revision_no" INTEGER NOT NULL,
    "status" "TemplateStatus" NOT NULL,
    "effective_date" DATE,
    "supersedes_id" UUID,
    "created_by" UUID NOT NULL,
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ,
    "qc_approved_by" UUID,
    "qc_approved_at" TIMESTAMPTZ,
    "qa_signed_by" UUID,
    "qa_signed_at" TIMESTAMPTZ,
    "rejection_comment" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "spec_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spec_template_tests" (
    "id" UUID NOT NULL,
    "spec_template_id" UUID NOT NULL,
    "test_parameter_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_included" BOOLEAN NOT NULL DEFAULT true,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "override_min_value" DECIMAL(65,30),
    "override_max_value" DECIMAL(65,30),
    "override_acceptance" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spec_template_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_master_id" UUID NOT NULL,
    "spec_template_id" UUID NOT NULL,
    "batch_no" TEXT NOT NULL,
    "arn" TEXT NOT NULL,
    "mfg_date_month" INTEGER NOT NULL,
    "mfg_date_year" INTEGER NOT NULL,
    "expiry_date" DATE NOT NULL,
    "batch_size" DECIMAL(65,30),
    "batch_size_uom" TEXT,
    "qty_sampled" DECIMAL(65,30),
    "qty_sampled_uom" TEXT,
    "customer_name" TEXT,
    "customer_ref" TEXT,
    "customer_special_instructions" TEXT,
    "current_doc_phase" "DocPhase" NOT NULL,
    "status" "BatchStatus" NOT NULL,
    "assigned_qc_exec_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_documents" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "doc_type" "DocType" NOT NULL,
    "doc_no" TEXT NOT NULL,
    "status" "DocStatus" NOT NULL,
    "source_template_id" UUID,
    "source_master_id" UUID,
    "optional_tests_activated" TEXT[],
    "created_by" UUID,
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ,
    "qc_approved_by" UUID,
    "qc_approved_at" TIMESTAMPTZ,
    "qa_signed_by" UUID,
    "qa_signed_at" TIMESTAMPTZ,
    "rejection_comment" TEXT,
    "rejected_by" UUID,
    "rejected_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "batch_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aws_sections" (
    "id" UUID NOT NULL,
    "batch_document_id" UUID NOT NULL,
    "test_parameter_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "status" "SectionStatus" NOT NULL,
    "instrument_id" UUID,
    "instrument_expired_ack" BOOLEAN NOT NULL DEFAULT false,
    "reagents_used" JSONB,
    "observations" JSONB,
    "analyzed_by" UUID,
    "checked_by" UUID,
    "calculated_result" DECIMAL(65,30),
    "result_display" TEXT,
    "conclusion" "Conclusion",
    "oos_detected" BOOLEAN NOT NULL DEFAULT false,
    "oos_acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "oos_acknowledged_at" TIMESTAMPTZ,
    "remarks" TEXT,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "aws_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coa_results" (
    "id" UUID NOT NULL,
    "batch_document_id" UUID NOT NULL,
    "test_name" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "acceptance_limits" TEXT NOT NULL,
    "conclusion" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coa_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_attachments" (
    "id" UUID NOT NULL,
    "aws_section_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "file_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instruments" (
    "id" UUID NOT NULL,
    "instrument_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department_id" UUID NOT NULL,
    "calibration_date" DATE,
    "use_before_date" DATE,
    "status" "InstrumentStatus" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reagents" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "lot_no" TEXT NOT NULL,
    "concentration" TEXT,
    "preparation_date" DATE,
    "expiry_date" DATE NOT NULL,
    "supplier" TEXT,
    "department_id" UUID NOT NULL,
    "status" "ReagentStatus" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reagents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_controls" (
    "id" UUID NOT NULL,
    "cc_no" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "initiated_by" UUID NOT NULL,
    "initiating_dept_id" UUID NOT NULL,
    "current_state" TEXT,
    "proposed_state" TEXT,
    "classification" "CCClassification",
    "status" "CCStatus" NOT NULL,
    "risk_assessment" TEXT,
    "accepted_by" UUID,
    "accepted_at" TIMESTAMPTZ,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "target_impl_date" DATE,
    "implemented_at" TIMESTAMPTZ,
    "extension_reason" TEXT,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ,
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ,
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "change_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_control_notifications" (
    "id" UUID NOT NULL,
    "change_control_id" UUID NOT NULL,
    "notified_dept_id" UUID NOT NULL,
    "notified_user_id" UUID,
    "notification_type" TEXT NOT NULL,
    "is_customer_facing" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_control_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "user_id" UUID,
    "user_name" TEXT,
    "role" TEXT,
    "department" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "doc_no" TEXT,
    "field_changed" TEXT,
    "old_value" TEXT,
    "new_value" TEXT,
    "comment" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arn_sequences" (
    "id" UUID NOT NULL,
    "financial_year" VARCHAR(9) NOT NULL,
    "last_sequence" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "arn_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE UNIQUE INDEX "spec_templates_template_no_key" ON "spec_templates"("template_no");

-- CreateIndex
CREATE INDEX "spec_templates_product_id_variant_type_status_idx" ON "spec_templates"("product_id", "variant_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "batches_batch_no_key" ON "batches"("batch_no");

-- CreateIndex
CREATE UNIQUE INDEX "batches_arn_key" ON "batches"("arn");

-- CreateIndex
CREATE INDEX "batches_product_id_status_idx" ON "batches"("product_id", "status");

-- CreateIndex
CREATE INDEX "batch_documents_batch_id_doc_type_idx" ON "batch_documents"("batch_id", "doc_type");

-- CreateIndex
CREATE INDEX "batch_documents_status_doc_type_idx" ON "batch_documents"("status", "doc_type");

-- CreateIndex
CREATE INDEX "aws_sections_batch_document_id_idx" ON "aws_sections"("batch_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "instruments_instrument_code_key" ON "instruments"("instrument_code");

-- CreateIndex
CREATE UNIQUE INDEX "change_controls_cc_no_key" ON "change_controls"("cc_no");

-- CreateIndex
CREATE INDEX "change_controls_status_classification_idx" ON "change_controls"("status", "classification");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_timestamp_idx" ON "audit_logs"("user_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_created_at_idx" ON "notifications"("user_id", "is_read", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "arn_sequences_financial_year_key" ON "arn_sequences"("financial_year");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_masters" ADD CONSTRAINT "product_masters_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_masters" ADD CONSTRAINT "product_masters_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "product_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_masters" ADD CONSTRAINT "product_masters_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_masters" ADD CONSTRAINT "product_masters_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_masters" ADD CONSTRAINT "product_masters_qc_approved_by_fkey" FOREIGN KEY ("qc_approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_masters" ADD CONSTRAINT "product_masters_qa_signed_by_fkey" FOREIGN KEY ("qa_signed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_parameters" ADD CONSTRAINT "test_parameters_product_master_id_fkey" FOREIGN KEY ("product_master_id") REFERENCES "product_masters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_parameters" ADD CONSTRAINT "test_parameters_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moa_sections" ADD CONSTRAINT "moa_sections_product_master_id_fkey" FOREIGN KEY ("product_master_id") REFERENCES "product_masters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moa_sections" ADD CONSTRAINT "moa_sections_test_parameter_id_fkey" FOREIGN KEY ("test_parameter_id") REFERENCES "test_parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_templates" ADD CONSTRAINT "spec_templates_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_templates" ADD CONSTRAINT "spec_templates_source_master_id_fkey" FOREIGN KEY ("source_master_id") REFERENCES "product_masters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_templates" ADD CONSTRAINT "spec_templates_copied_from_template_id_fkey" FOREIGN KEY ("copied_from_template_id") REFERENCES "spec_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_templates" ADD CONSTRAINT "spec_templates_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "spec_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_templates" ADD CONSTRAINT "spec_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_templates" ADD CONSTRAINT "spec_templates_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_templates" ADD CONSTRAINT "spec_templates_qc_approved_by_fkey" FOREIGN KEY ("qc_approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_templates" ADD CONSTRAINT "spec_templates_qa_signed_by_fkey" FOREIGN KEY ("qa_signed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_template_tests" ADD CONSTRAINT "spec_template_tests_spec_template_id_fkey" FOREIGN KEY ("spec_template_id") REFERENCES "spec_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_template_tests" ADD CONSTRAINT "spec_template_tests_test_parameter_id_fkey" FOREIGN KEY ("test_parameter_id") REFERENCES "test_parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_product_master_id_fkey" FOREIGN KEY ("product_master_id") REFERENCES "product_masters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_spec_template_id_fkey" FOREIGN KEY ("spec_template_id") REFERENCES "spec_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_assigned_qc_exec_id_fkey" FOREIGN KEY ("assigned_qc_exec_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_documents" ADD CONSTRAINT "batch_documents_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_documents" ADD CONSTRAINT "batch_documents_source_template_id_fkey" FOREIGN KEY ("source_template_id") REFERENCES "spec_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_documents" ADD CONSTRAINT "batch_documents_source_master_id_fkey" FOREIGN KEY ("source_master_id") REFERENCES "product_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_documents" ADD CONSTRAINT "batch_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_documents" ADD CONSTRAINT "batch_documents_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_documents" ADD CONSTRAINT "batch_documents_qc_approved_by_fkey" FOREIGN KEY ("qc_approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_documents" ADD CONSTRAINT "batch_documents_qa_signed_by_fkey" FOREIGN KEY ("qa_signed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_documents" ADD CONSTRAINT "batch_documents_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aws_sections" ADD CONSTRAINT "aws_sections_batch_document_id_fkey" FOREIGN KEY ("batch_document_id") REFERENCES "batch_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aws_sections" ADD CONSTRAINT "aws_sections_test_parameter_id_fkey" FOREIGN KEY ("test_parameter_id") REFERENCES "test_parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aws_sections" ADD CONSTRAINT "aws_sections_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aws_sections" ADD CONSTRAINT "aws_sections_analyzed_by_fkey" FOREIGN KEY ("analyzed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aws_sections" ADD CONSTRAINT "aws_sections_checked_by_fkey" FOREIGN KEY ("checked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coa_results" ADD CONSTRAINT "coa_results_batch_document_id_fkey" FOREIGN KEY ("batch_document_id") REFERENCES "batch_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_aws_section_id_fkey" FOREIGN KEY ("aws_section_id") REFERENCES "aws_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reagents" ADD CONSTRAINT "reagents_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_controls" ADD CONSTRAINT "change_controls_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_controls" ADD CONSTRAINT "change_controls_initiating_dept_id_fkey" FOREIGN KEY ("initiating_dept_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_notifications" ADD CONSTRAINT "change_control_notifications_change_control_id_fkey" FOREIGN KEY ("change_control_id") REFERENCES "change_controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_notifications" ADD CONSTRAINT "change_control_notifications_notified_dept_id_fkey" FOREIGN KEY ("notified_dept_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_notifications" ADD CONSTRAINT "change_control_notifications_notified_user_id_fkey" FOREIGN KEY ("notified_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
