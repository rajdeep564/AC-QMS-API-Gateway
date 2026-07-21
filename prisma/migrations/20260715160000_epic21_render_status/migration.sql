-- Epic 21: track DOC-Module render lifecycle (non-blocking of approvals)
CREATE TYPE "RenderStatus" AS ENUM ('PENDING', 'RENDERED', 'FAILED');

ALTER TABLE "specs"
  ADD COLUMN "render_status" "RenderStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "render_error" TEXT;

ALTER TABLE "batch_documents"
  ADD COLUMN "render_status" "RenderStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "render_error" TEXT;
