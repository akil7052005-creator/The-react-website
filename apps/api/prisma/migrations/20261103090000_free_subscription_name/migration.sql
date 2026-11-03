-- The free plan's display name: "Trial" becomes "Free Subscription". Only the text shown to people
-- changes: the code (STARTER), the trial flag, limits, prices and payments stay as they are.
UPDATE "plans" SET
  "name" = 'Free Subscription',
  "tagline" = 'Free Subscription Up to December 31'
WHERE "code" = 'STARTER';

-- The FAQ that names the plans (only if it still has the old wording).
UPDATE "faqs" SET "answer" = REPLACE("answer", 'Trial and Pro include 1 account', 'Free Subscription and Pro include 1 account')
WHERE "answer" LIKE '%Trial and Pro include 1 account%';
