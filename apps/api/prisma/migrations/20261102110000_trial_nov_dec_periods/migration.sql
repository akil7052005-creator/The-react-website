-- Free trial in two allowance periods: November 2026 and December 2026, each with 5 customer events
-- and 50 GB of uploads (unused ones don't carry over), free until 31 Dec 2026 23:59:59 IST.
-- The period dates live in code (TRIAL_OFFER_PERIODS in packages/shared/src/subscriptions.ts); the
-- Trial plan's eventsTotal / uploadGbTotal are now "per period". Events and uploads are counted by
-- the date they were made, so everything created before 1 Dec counts towards November and nothing
-- needs moving. Prices, Razorpay plans and payments are not touched; nothing is deleted.
UPDATE "plans" SET
  "tagline" = 'Try everything free until 31 Dec',
  "limits" = "limits" || '{"eventsTotal": 5, "photosPerEvent": 3500, "uploadGbTotal": 50}'::jsonb,
  "features" = '["5 customer events in November + 5 in December", "Up to 3,500 photos per event", "50 GB of uploads each month (about 5,000 photos)", "Customer gallery open 7 days", "No card needed", "Customers pick with a heart"]'::jsonb
WHERE "code" = 'STARTER';

-- Pro: only the uploads wording changes, to make clear the 500 GB a month is shared by all events.
UPDATE "plans" SET "features" = (
  SELECT jsonb_agg(CASE WHEN f = '500 GB of uploads a month' THEN '500 GB of uploads a month (all events)' ELSE f END ORDER BY i)
  FROM jsonb_array_elements_text("features") WITH ORDINALITY AS t(f, i)
)
WHERE "code" = 'PRO' AND "features" ? '500 GB of uploads a month';

-- Studios on an active trial end on 31 Dec 2026, 23:59:59 IST (18:29:59 UTC). Most were moved there
-- by 20261102100000_plan_limits_nov26; this catches any that weren't. Trials that already ended
-- (grace, expired, cancelled) are left as they are. Each change is logged in the subscription's history.
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
SELECT gen_random_uuid(), "id", 'EXTENDED_BY_ADMIN', 'Trial extended: free until 31 Dec 2026 (5 events + 50 GB in November, and again in December)', NOW()
FROM extended;
