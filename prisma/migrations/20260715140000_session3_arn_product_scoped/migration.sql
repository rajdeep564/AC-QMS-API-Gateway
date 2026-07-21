-- Pre-production: reset ARN sequences for QA-09 per-product scope
TRUNCATE TABLE "arn_sequences";

-- Drop old FY-only unique constraint
DROP INDEX IF EXISTS "arn_sequences_fy_key";

-- Add product_id (required)
ALTER TABLE "arn_sequences" ADD COLUMN "product_id" UUID NOT NULL;

-- FK to products
ALTER TABLE "arn_sequences" ADD CONSTRAINT "arn_sequences_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Unique (fy, product_id)
CREATE UNIQUE INDEX "arn_sequences_fy_product_id_key" ON "arn_sequences"("fy", "product_id");
