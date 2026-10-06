-- Every paid plan payment gets a GST invoice number (WZ/<FY>-<yy>/<seq>), including the ones made
-- before invoice numbers existed. Only rows without a number are touched, so this is safe to re-run.

-- 1. When they were paid (decides the financial year).
UPDATE "payments" SET "paid_at" = "created_at" WHERE "status" = 'SUCCESS' AND "paid_at" IS NULL;

-- 2. Number them in payment order, per Indian financial year (April–March, in IST), continuing after
--    the highest number already issued (or counted) in that year.
WITH todo AS (
  SELECT p."id", p."paid_at",
    EXTRACT(YEAR FROM (p."paid_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'))::int
      - CASE WHEN EXTRACT(MONTH FROM (p."paid_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')) < 4 THEN 1 ELSE 0 END AS fy
  FROM "payments" p
  WHERE p."purpose" = 'SUBSCRIPTION' AND p."status" = 'SUCCESS' AND p."invoice_number" IS NULL
),
issued AS (
  SELECT split_part(split_part("invoice_number", '/', 2), '-', 1)::int AS fy, MAX(split_part("invoice_number", '/', 3)::int) AS last
  FROM "payments"
  WHERE "invoice_number" LIKE 'WZ/%'
  GROUP BY 1
),
numbered AS (
  SELECT t."id", t."fy",
    GREATEST(COALESCE(i."last", 0), COALESCE(c."value", 0)) + ROW_NUMBER() OVER (PARTITION BY t."fy" ORDER BY t."paid_at", t."id") AS seq
  FROM todo t
  LEFT JOIN issued i ON i."fy" = t."fy"
  LEFT JOIN "platform_counters" c ON c."key" = 'invoice:' || t."fy"
)
UPDATE "payments" p
SET "invoice_number" = 'WZ/' || n."fy" || '-' || LPAD(((n."fy" + 1) % 100)::text, 2, '0') || '/' || LPAD(n."seq"::text, 5, '0')
FROM numbered n
WHERE p."id" = n."id";

-- 3. Move each year's counter past every number issued, so new invoices continue the series.
INSERT INTO "platform_counters" ("key", "value")
SELECT 'invoice:' || split_part(split_part("invoice_number", '/', 2), '-', 1), MAX(split_part("invoice_number", '/', 3)::int)
FROM "payments"
WHERE "invoice_number" LIKE 'WZ/%'
GROUP BY 1
ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("platform_counters"."value", EXCLUDED."value");

-- 4. Billing periods for the same old payments (used by the admin MRR trend).
UPDATE "payments"
SET "period_start" = "paid_at",
    "period_end" = "paid_at" + CASE WHEN "cycle" = 'YEARLY' THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END
WHERE "purpose" = 'SUBSCRIPTION' AND "status" = 'SUCCESS' AND "period_start" IS NULL;
