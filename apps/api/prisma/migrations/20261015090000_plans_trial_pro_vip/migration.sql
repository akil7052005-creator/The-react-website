-- Update 2: Trial / Pro / VIP with 1, 3, 6 and 12-month billing.
ALTER TYPE "BillingCycle" ADD VALUE IF NOT EXISTS 'QUARTERLY';
ALTER TYPE "BillingCycle" ADD VALUE IF NOT EXISTS 'HALF_YEARLY';
ALTER TYPE "PaymentPurpose" ADD VALUE IF NOT EXISTS 'EVENT_ADDON';

-- Price of each billing period, in paise: {"MONTHLY":…, "QUARTERLY":…, "HALF_YEARLY":…, "YEARLY":…}.
ALTER TABLE "plans" ADD COLUMN "prices" JSONB NOT NULL DEFAULT '{}';

-- Monthly limits reset every 30 days from this date (the plan's start).
ALTER TABLE "subscriptions" ADD COLUMN "usage_anchor" TIMESTAMP(3);
UPDATE "subscriptions" SET "usage_anchor" = "current_period_start";

-- "+5 events" bought for one usage window.
CREATE TABLE "usage_addons" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "events" INTEGER NOT NULL,
    "payment_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_addons_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "usage_addons_studio_id_window_start_idx" ON "usage_addons"("studio_id", "window_start");
ALTER TABLE "usage_addons" ADD CONSTRAINT "usage_addons_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The plans themselves (admins can change them afterwards in Admin → Plans).
-- Starter becomes Trial (free, 14 days), All-Access becomes VIP, Pro gets its new limits; Studio is retired
-- (hidden; nobody is on it). Existing subscriptions keep their plan rows, events and photos.
UPDATE "plans" SET
  "name" = 'Trial',
  "tagline" = 'Try everything free for 14 days',
  "monthly_price" = NULL,
  "yearly_price" = 0,
  "prices" = '{}',
  "popular" = false,
  "sort_order" = 1,
  "limits" = '{"eventsPerMonth": null, "eventsTotal": 2, "photosPerEvent": 100, "uploadGbPerMonth": null, "uploadGbTotal": 2, "trialDays": 14, "galleryDays": 7, "favourites": false, "albums": 2, "storageGb": null, "teamSeats": 1, "includedCredits": 0, "maxPhotoMb": 100, "maxFilesPerUpload": 100, "uploadConcurrency": 4}',
  "features" = '["2 customer events", "100 photos per event", "About 2 GB of uploads", "Customer gallery open 7 days", "14-day trial"]',
  "coming_soon" = '[]'
WHERE "code" = 'STARTER';

UPDATE "plans" SET
  "name" = 'Pro',
  "tagline" = 'For busy wedding studios',
  "monthly_price" = 199900,
  "yearly_price" = 1999900,
  "prices" = '{"MONTHLY": 199900, "QUARTERLY": 539900, "HALF_YEARLY": 1019900, "YEARLY": 1999900}',
  "popular" = true,
  "sort_order" = 2,
  "limits" = '{"eventsPerMonth": 10, "eventsTotal": null, "photosPerEvent": 2000, "uploadGbPerMonth": 500, "uploadGbTotal": null, "addonEvents": 5, "addonEventsPricePaise": 49900, "favourites": false, "albums": 50, "storageGb": null, "teamSeats": 1, "includedCredits": 0, "maxPhotoMb": 100, "maxFilesPerUpload": 2000, "uploadConcurrency": 4}',
  "features" = '["10 new customer events a month", "2,000 photos per event", "500 GB of uploads a month", "+5 events add-on any month", "Pick with a heart"]',
  "coming_soon" = '[]'
WHERE "code" = 'PRO';

UPDATE "plans" SET
  "name" = 'VIP',
  "tagline" = 'Unlimited events, favourites included',
  "monthly_price" = 499900,
  "yearly_price" = 4999900,
  "prices" = '{"MONTHLY": 499900, "QUARTERLY": 1349900, "HALF_YEARLY": 2549900, "YEARLY": 4999900}',
  "popular" = false,
  "sort_order" = 3,
  "limits" = '{"eventsPerMonth": null, "eventsTotal": null, "fairUseEventsPerMonth": 300, "photosPerEvent": 5000, "uploadGbPerMonth": 1024, "uploadGbTotal": null, "favourites": true, "albums": null, "storageGb": null, "teamSeats": 10, "includedCredits": 0, "maxPhotoMb": 100, "maxFilesPerUpload": 5000, "uploadConcurrency": 6}',
  "features" = '["Unlimited customer events (fair use)", "5,000 photos per event", "1 TB of uploads a month", "Customer favourites", "Priority support"]',
  "coming_soon" = '[]'
WHERE "code" = 'ALL_ACCESS';

UPDATE "plans" SET "is_active" = false, "popular" = false, "sort_order" = 9 WHERE "code" = 'STUDIO';

-- Grace after a plan ends is now 7 days (view-only, no new uploads).
UPDATE "platform_settings" SET "value" = jsonb_set("value", '{graceDays}', '7') WHERE "key" = 'alerts' AND "value" ? 'graceDays';
