-- Studio workflow: folders, gallery access (PIN, downloads, watermark), activity log, studio
-- defaults, and album cover/review fields. Additive only: new tables, and nullable columns or
-- columns with safe defaults. Existing selections, photos and albums keep working unchanged.

-- 1. Folders in a selection (Haldi, Mehendi, Wedding, Reception...).
CREATE TABLE "selection_folders" (
    "id" UUID NOT NULL,
    "selection_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "selection_folders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "selection_folders_selection_id_name_key" ON "selection_folders"("selection_id", "name");
ALTER TABLE "selection_folders" ADD CONSTRAINT "selection_folders_selection_id_fkey" FOREIGN KEY ("selection_id") REFERENCES "selections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Photos: their folder, and the client preview (resized; watermarked when the studio wants).
ALTER TABLE "photos" ADD COLUMN "folder_id" UUID;
ALTER TABLE "photos" ADD COLUMN "preview_file_id" UUID;
CREATE INDEX "photos_folder_id_idx" ON "photos"("folder_id");
CREATE UNIQUE INDEX "photos_preview_file_id_key" ON "photos"("preview_file_id");
ALTER TABLE "photos" ADD CONSTRAINT "photos_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "selection_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "photos" ADD CONSTRAINT "photos_preview_file_id_fkey" FOREIGN KEY ("preview_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing selection photos go into folders: the top folder they were uploaded from, or "General".
INSERT INTO "selection_folders" ("id", "selection_id", "name", "position")
SELECT gen_random_uuid(), t."selection_id", t."name",
       (ROW_NUMBER() OVER (PARTITION BY t."selection_id" ORDER BY t."name" = 'General', t."name"))::int - 1
FROM (
    SELECT DISTINCT "selection_id", COALESCE(NULLIF(split_part("folder", '/', 1), ''), 'General') AS "name"
    FROM "photos" WHERE "selection_id" IS NOT NULL
) t;
UPDATE "photos" p SET "folder_id" = f."id"
FROM "selection_folders" f
WHERE p."selection_id" = f."selection_id"
  AND f."name" = COALESCE(NULLIF(split_part(p."folder", '/', 1), ''), 'General');

-- 3. Selections: gallery access settings and client activity.
ALTER TABLE "selections" ADD COLUMN "pin_hash" TEXT;
ALTER TABLE "selections" ADD COLUMN "pin_failures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "selections" ADD COLUMN "pin_locked_until" TIMESTAMP(3);
ALTER TABLE "selections" ADD COLUMN "allow_download" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "selections" ADD COLUMN "watermark" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "selections" ADD COLUMN "notes_allowed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "selections" ADD COLUMN "shared_at" TIMESTAMP(3);
ALTER TABLE "selections" ADD COLUMN "delivered_at" TIMESTAMP(3);
ALTER TABLE "selections" ADD COLUMN "last_client_visit_at" TIMESTAMP(3);
ALTER TABLE "selections" ADD COLUMN "client_visits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "selections" ADD COLUMN "auto_reminders" INTEGER NOT NULL DEFAULT 0;
-- Selections that were already shared: use the last update as the share time.
UPDATE "selections" SET "shared_at" = "updated_at" WHERE "status" <> 'DRAFT' AND "shared_at" IS NULL;

-- 4. Selection change log (unlock, reset, delivered, PIN changes...).
CREATE TABLE "selection_log" (
    "id" UUID NOT NULL,
    "selection_id" UUID NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "selection_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "selection_log_selection_id_created_at_idx" ON "selection_log"("selection_id", "created_at");
ALTER TABLE "selection_log" ADD CONSTRAINT "selection_log_selection_id_fkey" FOREIGN KEY ("selection_id") REFERENCES "selections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Studio defaults for new selections (watermark, downloads, gallery expiry, notes).
ALTER TABLE "studios" ADD COLUMN "selection_defaults" JSONB;

-- 6. Albums: cover design, links, review and print.
ALTER TABLE "albums" ADD COLUMN "selection_id" UUID;
ALTER TABLE "albums" ADD COLUMN "cover_style" TEXT NOT NULL DEFAULT 'CLASSIC';
ALTER TABLE "albums" ADD COLUMN "cover_color" TEXT;
ALTER TABLE "albums" ADD COLUMN "text_color" TEXT;
ALTER TABLE "albums" ADD COLUMN "accent_color" TEXT;
ALTER TABLE "albums" ADD COLUMN "cover_details" JSONB;
ALTER TABLE "albums" ADD COLUMN "song_url" TEXT;
ALTER TABLE "albums" ADD COLUMN "video_url" TEXT;
ALTER TABLE "albums" ADD COLUMN "back_cover_photo_id" UUID;
ALTER TABLE "albums" ADD COLUMN "view_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "albums" ADD COLUMN "approved_at" TIMESTAMP(3);
ALTER TABLE "albums" ADD COLUMN "sent_to_print_at" TIMESTAMP(3);
ALTER TABLE "albums" ADD CONSTRAINT "albums_selection_id_fkey" FOREIGN KEY ("selection_id") REFERENCES "selections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- To undo (no existing data is lost; only the new columns and tables go):
--   ALTER TABLE "albums" DROP CONSTRAINT "albums_selection_id_fkey";
--   ALTER TABLE "albums" DROP COLUMN "selection_id", DROP COLUMN "cover_style", DROP COLUMN "cover_color",
--     DROP COLUMN "text_color", DROP COLUMN "accent_color", DROP COLUMN "cover_details", DROP COLUMN "song_url",
--     DROP COLUMN "video_url", DROP COLUMN "back_cover_photo_id", DROP COLUMN "view_count",
--     DROP COLUMN "approved_at", DROP COLUMN "sent_to_print_at";
--   ALTER TABLE "studios" DROP COLUMN "selection_defaults";
--   DROP TABLE "selection_log";
--   ALTER TABLE "selections" DROP COLUMN "pin_hash", DROP COLUMN "pin_failures", DROP COLUMN "pin_locked_until",
--     DROP COLUMN "allow_download", DROP COLUMN "watermark", DROP COLUMN "notes_allowed", DROP COLUMN "shared_at",
--     DROP COLUMN "delivered_at", DROP COLUMN "last_client_visit_at", DROP COLUMN "client_visits", DROP COLUMN "auto_reminders";
--   ALTER TABLE "photos" DROP COLUMN "folder_id", DROP COLUMN "preview_file_id";
--   DROP TABLE "selection_folders";
