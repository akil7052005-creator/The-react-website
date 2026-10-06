-- Share link (/select/:token): wrong customer codes are counted per selection; 5 lock the link for 10 minutes.
ALTER TABLE "selections" ADD COLUMN "code_failures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "selections" ADD COLUMN "code_locked_until" TIMESTAMP(3);
