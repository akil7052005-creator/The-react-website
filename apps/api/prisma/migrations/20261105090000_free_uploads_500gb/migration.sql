-- Free Subscription: 500 GB of uploads each trial month (November and December), the same as Pro's
-- 500 GB a month (was 50 GB). Only the upload limit and its feature line change: events, photos per
-- event, the 7-day gallery, prices and payments are not touched. Studios on the free plan get the
-- new limit straight away (uploads are checked against the plan's current limit).
UPDATE "plans" SET
  "limits" = "limits" || '{"uploadGbTotal": 500}'::jsonb,
  "features" = COALESCE(
    (
      SELECT jsonb_agg(CASE WHEN f = '50 GB of uploads each month (about 5,000 photos)' THEN '500 GB of uploads each month' ELSE f END ORDER BY i)
      FROM jsonb_array_elements_text("features") WITH ORDINALITY AS t(f, i)
    ),
    "features"
  )
WHERE "code" = 'STARTER';
