-- Update 8: new prices, billed for 1, 6 or 12 months (the 3-month option is no longer sold).
-- Paise, before GST. Existing subscriptions keep what they paid until they renew.
UPDATE "plans" SET "prices" = '{"MONTHLY": 60000, "HALF_YEARLY": 300000, "YEARLY": 500000}'::jsonb,
  "monthly_price" = 60000, "yearly_price" = 500000
WHERE "code" = 'PRO';
UPDATE "plans" SET "prices" = '{"MONTHLY": 120000, "HALF_YEARLY": 600000, "YEARLY": 1000000}'::jsonb,
  "monthly_price" = 120000, "yearly_price" = 1000000
WHERE "code" = 'ALL_ACCESS';
