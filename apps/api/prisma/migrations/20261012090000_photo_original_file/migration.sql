-- The full-quality original kept beside a compressed (80–85%) upload. Customers only ever get the
-- compressed copy; the studio's "Download from cloud" returns the original of each pick.
ALTER TABLE "photos" ADD COLUMN "original_file_id" UUID;
CREATE UNIQUE INDEX "photos_original_file_id_key" ON "photos"("original_file_id");
ALTER TABLE "photos" ADD CONSTRAINT "photos_original_file_id_fkey" FOREIGN KEY ("original_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
