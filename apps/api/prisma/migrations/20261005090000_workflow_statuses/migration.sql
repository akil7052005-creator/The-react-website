-- Studio workflow: new selection and album statuses. Additive only, existing rows keep their status.
-- New enum values are added in their own migration because Postgres can't use a value in the
-- transaction that added it.

-- Selection: Draft > Uploading > Shared (SENT) > In progress > Submitted > Delivered (+ derived Expired).
ALTER TYPE "SelectionStatus" ADD VALUE IF NOT EXISTS 'UPLOADING' AFTER 'DRAFT';
ALTER TYPE "SelectionStatus" ADD VALUE IF NOT EXISTS 'DELIVERED' AFTER 'SUBMITTED';

-- Album: Draft > In review > Changes requested > Approved > Sent to print (PUBLISHED stays for old rows).
ALTER TYPE "AlbumStatus" ADD VALUE IF NOT EXISTS 'CHANGES_REQUESTED' AFTER 'IN_REVIEW';
ALTER TYPE "AlbumStatus" ADD VALUE IF NOT EXISTS 'APPROVED' AFTER 'CHANGES_REQUESTED';
ALTER TYPE "AlbumStatus" ADD VALUE IF NOT EXISTS 'SENT_TO_PRINT';

-- To undo: Postgres can't drop enum values. Move rows off the new values first, then the old app
-- version works unchanged (it never reads the extra values):
--   UPDATE "selections" SET "status" = 'DRAFT' WHERE "status" = 'UPLOADING';
--   UPDATE "selections" SET "status" = 'SUBMITTED' WHERE "status" = 'DELIVERED';
--   UPDATE "albums" SET "status" = 'IN_REVIEW' WHERE "status" = 'CHANGES_REQUESTED';
--   UPDATE "albums" SET "status" = 'PUBLISHED' WHERE "status" IN ('APPROVED', 'SENT_TO_PRINT');
