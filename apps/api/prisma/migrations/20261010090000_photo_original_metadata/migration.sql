-- Compressed uploads: the original file's name, size and dimensions, kept so the original can be
-- found again on the studio's computer.
ALTER TABLE "photos" ADD COLUMN "original_name" TEXT;
ALTER TABLE "photos" ADD COLUMN "original_width" INTEGER;
ALTER TABLE "photos" ADD COLUMN "original_height" INTEGER;
ALTER TABLE "photos" ADD COLUMN "original_size" INTEGER;
ALTER TABLE "photos" ADD COLUMN "compressed" BOOLEAN NOT NULL DEFAULT false;
