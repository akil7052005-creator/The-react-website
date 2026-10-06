-- Customer portal (/selection/*): favourites, and which "Send Options" card last sent the code.
ALTER TABLE "photos" ADD COLUMN "client_favorite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "selections" ADD COLUMN "last_sent_at" TIMESTAMP(3);
ALTER TABLE "selections" ADD COLUMN "sent_via" TEXT;
