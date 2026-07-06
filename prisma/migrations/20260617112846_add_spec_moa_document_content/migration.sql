-- CreateTable
CREATE TABLE "spec_document_tests" (
    "id" UUID NOT NULL,
    "batch_document_id" UUID NOT NULL,
    "test_parameter_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "test_name" VARCHAR(200) NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL,
    "is_optional_activated" BOOLEAN NOT NULL DEFAULT false,
    "result_type" "ResultType" NOT NULL,
    "acceptance_criteria" TEXT,
    "min_value" DECIMAL(15,6),
    "max_value" DECIMAL(15,6),
    "operator" "Operator",
    "uom" VARCHAR(30),
    "department_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spec_document_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moa_document_sections" (
    "id" UUID NOT NULL,
    "batch_document_id" UUID NOT NULL,
    "test_parameter_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "test_name" VARCHAR(200) NOT NULL,
    "pharmacopoeia" VARCHAR(50),
    "sample_preparation" TEXT,
    "standard_preparation" TEXT,
    "blank_preparation" TEXT,
    "conclusion_template" TEXT,
    "additional_notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moa_document_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "spec_document_tests_batch_document_id_idx" ON "spec_document_tests"("batch_document_id");

-- CreateIndex
CREATE INDEX "spec_document_tests_test_parameter_id_idx" ON "spec_document_tests"("test_parameter_id");

-- CreateIndex
CREATE INDEX "moa_document_sections_batch_document_id_idx" ON "moa_document_sections"("batch_document_id");

-- CreateIndex
CREATE INDEX "moa_document_sections_test_parameter_id_idx" ON "moa_document_sections"("test_parameter_id");

-- AddForeignKey
ALTER TABLE "spec_document_tests" ADD CONSTRAINT "spec_document_tests_batch_document_id_fkey" FOREIGN KEY ("batch_document_id") REFERENCES "batch_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_document_tests" ADD CONSTRAINT "spec_document_tests_test_parameter_id_fkey" FOREIGN KEY ("test_parameter_id") REFERENCES "test_parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_document_tests" ADD CONSTRAINT "spec_document_tests_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moa_document_sections" ADD CONSTRAINT "moa_document_sections_batch_document_id_fkey" FOREIGN KEY ("batch_document_id") REFERENCES "batch_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moa_document_sections" ADD CONSTRAINT "moa_document_sections_test_parameter_id_fkey" FOREIGN KEY ("test_parameter_id") REFERENCES "test_parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
