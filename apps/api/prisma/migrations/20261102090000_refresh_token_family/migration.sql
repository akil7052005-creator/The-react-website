-- Refresh-token families: every login is one family; rotations stay in it. A rotated token is
-- remembered (rotated_at, replaced_by_id) so a request that raced the rotation can be told apart
-- from a stolen token. Existing tokens each become their own family, so nobody is logged out.
ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" UUID;
UPDATE "refresh_tokens" SET "family_id" = "id" WHERE "family_id" IS NULL;
ALTER TABLE "refresh_tokens" ALTER COLUMN "family_id" SET NOT NULL;
ALTER TABLE "refresh_tokens" ADD COLUMN "rotated_at" TIMESTAMP(3);
ALTER TABLE "refresh_tokens" ADD COLUMN "replaced_by_id" UUID;
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");
