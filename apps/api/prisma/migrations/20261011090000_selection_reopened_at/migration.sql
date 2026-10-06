-- Reset Selection / Unlock: the studio reopened a submitted selection. Shown as "Pending" until the
-- client submits again (which clears it). Nullable, so existing selections are unchanged.
ALTER TABLE "selections" ADD COLUMN "reopened_at" TIMESTAMP(3);
