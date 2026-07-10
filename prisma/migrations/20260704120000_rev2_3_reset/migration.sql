-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SADMIN', 'QC_EXEC', 'QC_MGR', 'QA_EXEC', 'QA_MGR', 'MKT_EXEC');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "DeptName" AS ENUM ('QC', 'QA', 'MARKETING');

-- CreateEnum
CREATE TYPE "MasterStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "FieldDataType" AS ENUM ('TEXT', 'NUMBER', 'DATE');

-- CreateEnum
CREATE TYPE "SpecVariant" AS ENUM ('GENERAL', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "StandingDocStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'QC_APPROVED', 'QA_SIGNED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ResultType" AS ENUM ('QUALITATIVE', 'QUANTITATIVE');

-- CreateEnum
CREATE TYPE "Operator" AS ENUM ('NMT', 'NLT', 'BETWEEN', 'EQUALS', 'TEXT');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RELEASED');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('AWS', 'COA');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('PENDING', 'DRAFT', 'SUBMITTED', 'QC_APPROVED', 'QA_SIGNED', 'REJECTED', 'AUTO_GENERATED', 'ISSUED');

-- CreateEnum
CREATE TYPE "SectionStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'AWAITING_CHECK', 'COMPLETE');

-- CreateEnum
CREATE TYPE "Conclusion" AS ENUM ('SATISFACTORY', 'NOT_SATISFACTORY', 'PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "CoaComplianceVerdict" AS ENUM ('COMPLIES', 'DOES_NOT_COMPLY');

-- CreateEnum
CREATE TYPE "FileType" AS ENUM ('DOCX', 'PDF', 'READING_ATTACHMENT');

-- CreateEnum
CREATE TYPE "CCStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CCCategory" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

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
    "name" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "assigned_to" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "rejection_comment" TEXT,
    "imported_from" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "product_masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_master_fields" (
    "id" UUID NOT NULL,
    "product_master_id" UUID NOT NULL,
    "field_key" VARCHAR(80) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "value" TEXT,
    "data_type" "FieldDataType" NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "product_master_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "specs" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant" "SpecVariant" NOT NULL,
    "customer_id" UUID,
    "spec_no" VARCHAR(80) NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "status" "StandingDocStatus" NOT NULL,
    "created_by" UUID NOT NULL,
    "submitted_by" UUID,
    "qc_approved_by" UUID,
    "qa_signed_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "effective_date" DATE,
    "supersedes_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "specs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spec_tests" (
    "id" UUID NOT NULL,
    "spec_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "test_name" VARCHAR(200) NOT NULL,
    "result_type" "ResultType" NOT NULL,
    "operator" "Operator",
    "min_value" DECIMAL(15,6),
    "max_value" DECIMAL(15,6),
    "uom" VARCHAR(40),
    "acceptance_criteria" TEXT,
    "formula" TEXT,
    "formula_variables" JSONB,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "is_outside_lab" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spec_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moa_docs" (
    "id" UUID NOT NULL,
    "spec_id" UUID NOT NULL,
    "moa_no" VARCHAR(80) NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "status" "StandingDocStatus" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moa_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moa_doc_sections" (
    "id" UUID NOT NULL,
    "moa_doc_id" UUID NOT NULL,
    "spec_test_id" UUID NOT NULL,
    "pharmacopoeia" VARCHAR(50),
    "sample_preparation" TEXT,
    "standard_preparation" TEXT,
    "blank_preparation" TEXT,
    "reagent_preparation" TEXT,
    "instrument_parameters" TEXT,
    "system_suitability" TEXT,
    "sequence_table" TEXT,
    "procedure_text" TEXT,
    "formula_reference" TEXT,
    "conclusion_template" TEXT,
    "additional_notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moa_doc_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "source_spec_id" UUID NOT NULL,
    "batch_no" VARCHAR(80) NOT NULL,
    "arn_no" VARCHAR(80),
    "assigned_qc_exec_id" UUID,
    "status" "BatchStatus" NOT NULL,
    "mfg_date" DATE,
    "exp_date" DATE,
    "batch_size" VARCHAR(60),
    "created_by" UUID NOT NULL,
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_documents" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "doc_type" "DocType" NOT NULL,
    "doc_no" VARCHAR(80) NOT NULL,
    "status" "DocStatus" NOT NULL,
    "compliance_verdict" "CoaComplianceVerdict",
    "created_by" UUID,
    "submitted_by" UUID,
    "qc_approved_by" UUID,
    "qa_signed_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spec_document_tests" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "source_spec_test_id" UUID,
    "test_name" VARCHAR(200) NOT NULL,
    "result_type" "ResultType" NOT NULL,
    "operator" "Operator",
    "min_value" DECIMAL(15,6),
    "max_value" DECIMAL(15,6),
    "uom" VARCHAR(40),
    "acceptance_criteria" TEXT,
    "formula" TEXT,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spec_document_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moa_document_sections" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "source_moa_section_id" UUID,
    "spec_document_test_id" UUID NOT NULL,
    "procedure_snapshot" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moa_document_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aws_sections" (
    "id" UUID NOT NULL,
    "batch_document_id" UUID NOT NULL,
    "spec_document_test_id" UUID NOT NULL,
    "status" "SectionStatus" NOT NULL,
    "readings" JSONB,
    "calculated_result" DECIMAL(15,6),
    "result_display" VARCHAR(120),
    "conclusion" "Conclusion",
    "is_oos" BOOLEAN NOT NULL DEFAULT false,
    "analyst_id" UUID,
    "checker_id" UUID,
    "instrument_id" UUID,
    "reagent_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aws_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coa_results" (
    "id" UUID NOT NULL,
    "batch_document_id" UUID NOT NULL,
    "test_name" VARCHAR(200) NOT NULL,
    "result" VARCHAR(200) NOT NULL,
    "acceptance_limits" VARCHAR(200),
    "conclusion" VARCHAR(40),
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "coa_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_attachments" (
    "id" UUID NOT NULL,
    "batch_document_id" UUID,
    "spec_id" UUID,
    "file_type" "FileType" NOT NULL,
    "file_path" VARCHAR(500) NOT NULL,
    "generated_by" VARCHAR(60),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instruments" (
    "id" UUID NOT NULL,
    "instrument_id" VARCHAR(60) NOT NULL,
    "name" VARCHAR(200),
    "calibration_date" DATE,
    "use_before" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reagents" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "lot_no" VARCHAR(80),
    "expiry_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reagents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_controls" (
    "id" UUID NOT NULL,
    "cc_no" VARCHAR(60) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "status" "CCStatus" NOT NULL,
    "category" "CCCategory",
    "raised_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_control_notifications" (
    "id" UUID NOT NULL,
    "change_control_id" UUID NOT NULL,
    "recipient_scope" VARCHAR(120),
    "acknowledged_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "departmentId" UUID,

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
    "type" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "message" TEXT,
    "link" VARCHAR(300),
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arn_sequences" (
    "id" UUID NOT NULL,
    "fy" VARCHAR(12) NOT NULL,
    "seq" INTEGER NOT NULL,
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
CREATE INDEX "product_master_fields_product_master_id_idx" ON "product_master_fields"("product_master_id");

-- CreateIndex
CREATE UNIQUE INDEX "moa_docs_spec_id_key" ON "moa_docs"("spec_id");

-- CreateIndex
CREATE UNIQUE INDEX "spec_tests_spec_id_sort_order_key" ON "spec_tests"("spec_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "batches_batch_no_key" ON "batches"("batch_no");

-- CreateIndex
CREATE INDEX "batch_documents_batch_id_doc_type_idx" ON "batch_documents"("batch_id", "doc_type");

-- CreateIndex
CREATE INDEX "spec_document_tests_batch_id_idx" ON "spec_document_tests"("batch_id");

-- CreateIndex
CREATE INDEX "moa_document_sections_batch_id_idx" ON "moa_document_sections"("batch_id");

-- CreateIndex
CREATE INDEX "aws_sections_batch_document_id_idx" ON "aws_sections"("batch_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "instruments_instrument_id_key" ON "instruments"("instrument_id");

-- CreateIndex
CREATE UNIQUE INDEX "change_controls_cc_no_key" ON "change_controls"("cc_no");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_timestamp_idx" ON "audit_logs"("user_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_created_at_idx" ON "notifications"("user_id", "is_read", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "arn_sequences_fy_key" ON "arn_sequences"("fy");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_masters" ADD CONSTRAINT "product_masters_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_masters" ADD CONSTRAINT "product_masters_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "product_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_masters" ADD CONSTRAINT "product_masters_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_masters" ADD CONSTRAINT "product_masters_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_masters" ADD CONSTRAINT "product_masters_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_master_fields" ADD CONSTRAINT "product_master_fields_product_master_id_fkey" FOREIGN KEY ("product_master_id") REFERENCES "product_masters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specs" ADD CONSTRAINT "specs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specs" ADD CONSTRAINT "specs_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "specs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specs" ADD CONSTRAINT "specs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specs" ADD CONSTRAINT "specs_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specs" ADD CONSTRAINT "specs_qc_approved_by_fkey" FOREIGN KEY ("qc_approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "specs" ADD CONSTRAINT "specs_qa_signed_by_fkey" FOREIGN KEY ("qa_signed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_tests" ADD CONSTRAINT "spec_tests_spec_id_fkey" FOREIGN KEY ("spec_id") REFERENCES "specs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moa_docs" ADD CONSTRAINT "moa_docs_spec_id_fkey" FOREIGN KEY ("spec_id") REFERENCES "specs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moa_doc_sections" ADD CONSTRAINT "moa_doc_sections_moa_doc_id_fkey" FOREIGN KEY ("moa_doc_id") REFERENCES "moa_docs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moa_doc_sections" ADD CONSTRAINT "moa_doc_sections_spec_test_id_fkey" FOREIGN KEY ("spec_test_id") REFERENCES "spec_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_source_spec_id_fkey" FOREIGN KEY ("source_spec_id") REFERENCES "specs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_assigned_qc_exec_id_fkey" FOREIGN KEY ("assigned_qc_exec_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_documents" ADD CONSTRAINT "batch_documents_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_documents" ADD CONSTRAINT "batch_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_documents" ADD CONSTRAINT "batch_documents_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_documents" ADD CONSTRAINT "batch_documents_qc_approved_by_fkey" FOREIGN KEY ("qc_approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_documents" ADD CONSTRAINT "batch_documents_qa_signed_by_fkey" FOREIGN KEY ("qa_signed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_document_tests" ADD CONSTRAINT "spec_document_tests_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_document_tests" ADD CONSTRAINT "spec_document_tests_source_spec_test_id_fkey" FOREIGN KEY ("source_spec_test_id") REFERENCES "spec_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moa_document_sections" ADD CONSTRAINT "moa_document_sections_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moa_document_sections" ADD CONSTRAINT "moa_document_sections_source_moa_section_id_fkey" FOREIGN KEY ("source_moa_section_id") REFERENCES "moa_doc_sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moa_document_sections" ADD CONSTRAINT "moa_document_sections_spec_document_test_id_fkey" FOREIGN KEY ("spec_document_test_id") REFERENCES "spec_document_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aws_sections" ADD CONSTRAINT "aws_sections_batch_document_id_fkey" FOREIGN KEY ("batch_document_id") REFERENCES "batch_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aws_sections" ADD CONSTRAINT "aws_sections_spec_document_test_id_fkey" FOREIGN KEY ("spec_document_test_id") REFERENCES "spec_document_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aws_sections" ADD CONSTRAINT "aws_sections_analyst_id_fkey" FOREIGN KEY ("analyst_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aws_sections" ADD CONSTRAINT "aws_sections_checker_id_fkey" FOREIGN KEY ("checker_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aws_sections" ADD CONSTRAINT "aws_sections_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aws_sections" ADD CONSTRAINT "aws_sections_reagent_id_fkey" FOREIGN KEY ("reagent_id") REFERENCES "reagents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coa_results" ADD CONSTRAINT "coa_results_batch_document_id_fkey" FOREIGN KEY ("batch_document_id") REFERENCES "batch_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_batch_document_id_fkey" FOREIGN KEY ("batch_document_id") REFERENCES "batch_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_spec_id_fkey" FOREIGN KEY ("spec_id") REFERENCES "specs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_controls" ADD CONSTRAINT "change_controls_raised_by_fkey" FOREIGN KEY ("raised_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_notifications" ADD CONSTRAINT "change_control_notifications_change_control_id_fkey" FOREIGN KEY ("change_control_id") REFERENCES "change_controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_notifications" ADD CONSTRAINT "change_control_notifications_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_control_notifications" ADD CONSTRAINT "change_control_notifications_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

