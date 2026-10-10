-- Update 1: R2 keeps only previews and thumbnails. Each photo records what the browser knew about
-- its original (path, timestamp, SHA-256), the thumbnail beside the preview, and the image format.
ALTER TABLE "photos" ADD COLUMN "relative_path" TEXT;
ALTER TABLE "photos" ADD COLUMN "last_modified" TIMESTAMP(3);
ALTER TABLE "photos" ADD COLUMN "sha256" TEXT;
ALTER TABLE "photos" ADD COLUMN "thumb_file_id" UUID;
ALTER TABLE "photos" ADD COLUMN "format" TEXT;

CREATE UNIQUE INDEX "photos_thumb_file_id_key" ON "photos"("thumb_file_id");
CREATE INDEX "photos_selection_id_sha256_idx" ON "photos"("selection_id", "sha256");

ALTER TABLE "photos" ADD CONSTRAINT "photos_thumb_file_id_fkey" FOREIGN KEY ("thumb_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
