-- Session 3B: US-12-12 OOS acknowledgement columns on aws_sections
ALTER TABLE "aws_sections"
  ADD COLUMN "oos_acknowledged" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "oos_acknowledged_at" TIMESTAMPTZ,
  ADD COLUMN "oos_ack_comment" TEXT;
