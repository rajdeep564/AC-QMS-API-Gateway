-- AlterTable
ALTER TABLE "aws_sections" ADD COLUMN     "spec_document_test_id" UUID;

-- CreateIndex
CREATE INDEX "aws_sections_spec_document_test_id_idx" ON "aws_sections"("spec_document_test_id");

-- AddForeignKey
ALTER TABLE "aws_sections" ADD CONSTRAINT "aws_sections_spec_document_test_id_fkey" FOREIGN KEY ("spec_document_test_id") REFERENCES "spec_document_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
