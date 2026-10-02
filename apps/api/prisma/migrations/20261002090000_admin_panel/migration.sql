-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "coming_soon" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "summary" TEXT NOT NULL,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_log_created_at_idx" ON "admin_audit_log"("created_at");

-- CreateIndex
CREATE INDEX "admin_audit_log_actor_user_id_created_at_idx" ON "admin_audit_log"("actor_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Carry over the features the app showed as "Coming soon" (previously fixed in the web app's code).
UPDATE "plans" SET "coming_soon" = (
  SELECT COALESCE(jsonb_agg(f), '[]'::jsonb)
  FROM jsonb_array_elements_text("features") AS f
  WHERE f IN ('Custom domain', '5 team seats', 'Priority support', 'Dedicated account manager')
);
