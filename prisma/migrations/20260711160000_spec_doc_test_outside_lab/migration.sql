-- Snapshot isOutsideLab from standing spec_tests onto frozen spec_document_tests (US-12-6 / Epic 12)
ALTER TABLE "spec_document_tests" ADD COLUMN "is_outside_lab" BOOLEAN NOT NULL DEFAULT false;
