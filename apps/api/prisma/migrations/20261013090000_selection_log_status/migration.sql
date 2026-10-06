-- The selection's status at the time of each log entry, so Client Activity shows the status then,
-- not the selection's status now. Existing entries get it from their action.
ALTER TABLE "selection_log" ADD COLUMN "status" TEXT;

UPDATE "selection_log" SET "status" = CASE
  WHEN "action" IN ('Opened the gallery', 'Started picking') THEN 'IN_PROGRESS'
  WHEN "action" = 'Submitted' THEN 'SUBMITTED'
  WHEN "action" IN ('Selection reopened by studio', 'Selection reset — shortlist kept', 'Selection reset — all picks rejected') THEN 'DRAFT'
END;
