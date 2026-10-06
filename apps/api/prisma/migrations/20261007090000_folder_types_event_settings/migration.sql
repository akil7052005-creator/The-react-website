-- Photo / video folders, per-event Photo Selection settings, and the studio's Instagram handle.
-- Additive only: new columns with safe defaults; existing rows keep working unchanged.

-- 1. Folder type. Existing folders hold photos.
ALTER TABLE "selection_folders" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'photo';

-- 2. Event settings that have no column of their own (client view, favourites, Instagram lock,
--    folder downloads, original quality, video download, gallery-expiry choice, watermark layout).
--    NULL = all defaults.
ALTER TABLE "selections" ADD COLUMN "settings" JSONB;

-- 3. The studio's Instagram handle (Profile » Social Setup), for the Instagram Follow lock.
ALTER TABLE "studios" ADD COLUMN "instagram_handle" TEXT;

-- To undo:
--   ALTER TABLE "studios" DROP COLUMN "instagram_handle";
--   ALTER TABLE "selections" DROP COLUMN "settings";
--   ALTER TABLE "selection_folders" DROP COLUMN "type";
