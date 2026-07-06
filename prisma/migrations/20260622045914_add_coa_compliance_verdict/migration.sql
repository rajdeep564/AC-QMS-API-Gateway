-- CreateEnum
CREATE TYPE "CoaComplianceVerdict" AS ENUM ('COMPLIES', 'DOES_NOT_COMPLY');

-- AlterTable
ALTER TABLE "batch_documents" ADD COLUMN     "compliance_verdict" "CoaComplianceVerdict";
