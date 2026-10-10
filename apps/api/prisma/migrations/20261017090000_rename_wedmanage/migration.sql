-- Rename the product to Wedmanage in text stored in the database (message templates, Help Center,
-- settings). Only display text: no keys, cookies, tables or storage paths change.
UPDATE "whatsapp_templates" SET "body" = replace(replace(replace("body", 'WeddyZone', 'Wedmanage'), 'Weddyzone', 'Wedmanage'), 'WEDDYZONE', 'WEDMANAGE'),
  "name" = replace(replace("name", 'WeddyZone', 'Wedmanage'), 'Weddyzone', 'Wedmanage')
WHERE "body" ILIKE '%weddyzone%' OR "name" ILIKE '%weddyzone%';
UPDATE "faqs" SET "question" = replace(replace("question", 'WeddyZone', 'Wedmanage'), 'Weddyzone', 'Wedmanage'),
  "answer" = replace(replace("answer", 'WeddyZone', 'Wedmanage'), 'Weddyzone', 'Wedmanage')
WHERE "question" ILIKE '%weddyzone%' OR "answer" ILIKE '%weddyzone%';
UPDATE "platform_settings" SET "value" = replace(replace("value"::text, 'WeddyZone', 'Wedmanage'), 'Weddyzone', 'Wedmanage')::jsonb
WHERE "value"::text LIKE '%Weddyzone%' OR "value"::text LIKE '%WeddyZone%';
