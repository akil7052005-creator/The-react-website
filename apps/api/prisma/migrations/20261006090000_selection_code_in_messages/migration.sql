-- The selection link and reminder messages also carry the selection's code ("Send" on Photo
-- Selection shares it with the customer). Only templates that don't mention {{code}} yet are
-- changed, so an edited template keeps its text and re-running is harmless.
UPDATE "whatsapp_templates"
SET "body" = "body" || E'\n\nYour selection code: {{code}}'
WHERE "key" IN ('SELECTION_INVITE', 'SELECTION_REMINDER') AND "body" NOT LIKE '%{{code}}%';

-- To undo:
--   UPDATE "whatsapp_templates" SET "body" = replace("body", E'\n\nYour selection code: {{code}}', '')
--   WHERE "key" IN ('SELECTION_INVITE', 'SELECTION_REMINDER');
