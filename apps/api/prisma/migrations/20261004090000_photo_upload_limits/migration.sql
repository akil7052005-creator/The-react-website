-- Photo uploads: plan-based limits and the folder a photo came from. Additive only.

-- 1. The folder a photo was uploaded from ("Haldi", "Wedding/Stage"). Nullable: existing photos keep null.
ALTER TABLE "photos" ADD COLUMN "folder" TEXT;

-- 2. Upload limits in each plan's limits JSON. `new || limits` keeps any value already set (an admin
--    edit wins), so this only fills in what is missing and is safe to re-run.
UPDATE "plans" SET "limits" = jsonb_build_object('maxPhotoMb', 25, 'maxFilesPerUpload', 300, 'uploadConcurrency', 3) || "limits" WHERE "code" = 'STARTER';
UPDATE "plans" SET "limits" = jsonb_build_object('maxPhotoMb', 50, 'maxFilesPerUpload', 1000, 'uploadConcurrency', 4) || "limits" WHERE "code" = 'PRO';
UPDATE "plans" SET "limits" = jsonb_build_object('maxPhotoMb', 80, 'maxFilesPerUpload', 3000, 'uploadConcurrency', 5) || "limits" WHERE "code" = 'STUDIO';
UPDATE "plans" SET "limits" = jsonb_build_object('maxPhotoMb', 100, 'maxFilesPerUpload', 5000, 'uploadConcurrency', 6) || "limits" WHERE "code" = 'ALL_ACCESS';

-- To undo (the app falls back to the Starter values when the keys are missing):
--   UPDATE "plans" SET "limits" = "limits" - 'maxPhotoMb' - 'maxFilesPerUpload' - 'uploadConcurrency';
--   ALTER TABLE "photos" DROP COLUMN "folder";
