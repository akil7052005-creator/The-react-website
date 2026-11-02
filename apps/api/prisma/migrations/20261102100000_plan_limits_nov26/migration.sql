-- New plan limits (Nov 2026). Prices, Razorpay plans and payments are not touched; nothing is deleted.
-- Trial: 5 customer events in total, 3,500 photos per event, 50 GB of uploads, free until 31 Dec 2026.
-- Pro: 3,500 photos per event. VIP: 7,000 photos per event. maxFilesPerUpload (photos per pick in
-- the uploader) follows photos per event, so a full event can be uploaded in one go.
UPDATE "plans" SET
  "tagline" = 'Try everything free until 31 Dec',
  "limits" = "limits" || '{"eventsTotal": 5, "photosPerEvent": 3500, "uploadGbTotal": 50, "maxFilesPerUpload": 3500}'::jsonb,
  "features" = '["5 customer events in total", "Up to 3,500 photos per event", "About 50 GB of uploads", "Customer gallery open 7 days", "Free until 31 Dec 2026"]'::jsonb
WHERE "code" = 'STARTER';

UPDATE "plans" SET
  "limits" = "limits" || '{"photosPerEvent": 3500, "maxFilesPerUpload": 3500}'::jsonb,
  "features" = '["10 new customer events a month", "Up to 3,500 photos per event", "500 GB of uploads a month", "+5 events add-on any month", "Pick with a heart"]'::jsonb
WHERE "code" = 'PRO';

UPDATE "plans" SET
  "limits" = "limits" || '{"photosPerEvent": 7000, "maxFilesPerUpload": 7000}'::jsonb,
  "features" = '["Unlimited customer events (fair use)", "Up to 7,000 photos per event", "1 TB of uploads a month", "Customer favourites", "Priority support"]'::jsonb
WHERE "code" = 'ALL_ACCESS';

-- Studios on an active trial: free until 31 Dec 2026, 23:59:59 IST (18:29:59 UTC). Trials that
-- already ended (grace, expired, cancelled) are left as they are. Each extension is logged in the
-- subscription's history (no actor: done by the system).
WITH extended AS (
  UPDATE "subscriptions"
  SET "current_period_end" = TIMESTAMP '2026-12-31 18:29:59', "status" = 'TRIAL', "updated_at" = NOW()
  WHERE "is_trial" = true
    AND "current_period_end" > NOW()
    AND "current_period_end" < TIMESTAMP '2026-12-31 18:29:59'
    AND "grace_ends_at" IS NULL
    AND "status" NOT IN ('GRACE', 'EXPIRED', 'CANCELLED')
  RETURNING "id"
)
INSERT INTO "subscription_events" ("id", "subscription_id", "type", "note", "created_at")
SELECT gen_random_uuid(), "id", 'EXTENDED_BY_ADMIN', 'Trial extended: free until 31 Dec 2026 (new Trial limits)', NOW()
FROM extended;
