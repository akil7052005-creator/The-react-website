-- Admin can remove a studio: it is closed at once and restorable for 30 days, then purged
-- (studio row kept, anonymised, only for tax/GST invoices and payments).
ALTER TABLE "studios" ADD COLUMN "removed_at" TIMESTAMP(3);
ALTER TABLE "studios" ADD COLUMN "removed_by_id" UUID;
ALTER TABLE "studios" ADD COLUMN "purged_at" TIMESTAMP(3);
CREATE INDEX "studios_removed_at_idx" ON "studios"("removed_at");
