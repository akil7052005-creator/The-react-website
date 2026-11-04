-- Plan payments a platform admin makes on a studio's behalf (Admin → Studios → Change plan).
-- Adds one empty column; existing payments, plans and prices are not touched.
ALTER TABLE "payments" ADD COLUMN "paid_by_admin_id" UUID;

ALTER TABLE "payments" ADD CONSTRAINT "payments_paid_by_admin_id_fkey" FOREIGN KEY ("paid_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
