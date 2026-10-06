-- CreateEnum
CREATE TYPE "SubscriptionEventType" AS ENUM ('CREATED', 'RENEWED', 'UPGRADED', 'DOWNGRADED', 'CANCELLED', 'EXPIRED', 'GRACE_STARTED', 'PAYMENT_FAILED', 'EXTENDED_BY_ADMIN', 'PLAN_CHANGED_BY_ADMIN', 'AUTO_RENEW_CHANGED');

-- CreateEnum
CREATE TYPE "CancelReason" AS ENUM ('TOO_EXPENSIVE', 'NOT_ENOUGH_WORK', 'MISSING_FEATURES', 'SWITCHING_TOOL', 'TECHNICAL_ISSUES', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationRecipient" AS ENUM ('ADMIN', 'STUDIO');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SubscriptionStatus" ADD VALUE 'TRIAL';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'EXPIRING_SOON';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'GRACE';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'PAYMENT_FAILED';

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_studio_id_fkey";

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
ADD COLUMN     "dedupe_key" TEXT,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "recipient_type" "NotificationRecipient" NOT NULL DEFAULT 'STUDIO',
ADD COLUMN     "sent_at" TIMESTAMP(3),
ADD COLUMN     "subscription_id" UUID,
ALTER COLUMN "studio_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "cycle" "BillingCycle",
ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "gateway_order_id" TEXT,
ADD COLUMN     "gateway_payment_id" TEXT,
ADD COLUMN     "gst" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "invoice_number" TEXT,
ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "period_end" TIMESTAMP(3),
ADD COLUMN     "period_start" TIMESTAMP(3),
ADD COLUMN     "plan_id" UUID,
ADD COLUMN     "subscription_id" UUID;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "amount_paid" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "anchor_day" INTEGER,
ADD COLUMN     "auto_renew" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cancel_details" TEXT,
ADD COLUMN     "cancel_reason" "CancelReason",
ADD COLUMN     "gateway_subscription_id" TEXT,
ADD COLUMN     "grace_ends_at" TIMESTAMP(3),
ADD COLUMN     "gst_amount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_payment_failed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totp_enabled_at" TIMESTAMP(3),
ADD COLUMN     "totp_secret" TEXT;

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "type" "SubscriptionEventType" NOT NULL,
    "from_plan" TEXT,
    "to_plan" TEXT,
    "amount" INTEGER,
    "actor_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "platform_counters" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "platform_counters_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "subscription_id" UUID,
    "percent_off" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "redeemed_at" TIMESTAMP(3),
    "payment_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscription_events_subscription_id_created_at_idx" ON "subscription_events"("subscription_id", "created_at");

-- CreateIndex
CREATE INDEX "subscription_events_type_created_at_idx" ON "subscription_events"("type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_recipient_type_channel_read_at_created_at_idx" ON "notifications"("recipient_type", "channel", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_subscription_id_created_at_idx" ON "notifications"("subscription_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gateway_order_id_key" ON "payments"("gateway_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gateway_payment_id_key" ON "payments"("gateway_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_invoice_number_key" ON "payments"("invoice_number");

-- CreateIndex
CREATE INDEX "payments_purpose_status_created_at_idx" ON "payments"("purpose", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_gateway_subscription_id_key" ON "subscriptions"("gateway_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_current_period_end_idx" ON "subscriptions"("current_period_end");

-- CreateIndex
CREATE INDEX "subscriptions_status_current_period_end_idx" ON "subscriptions"("status", "current_period_end");

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: link existing plan payments to their subscription and plan, and record what each
-- subscription last paid. Statuses (TRIAL, EXPIRING_SOON, ...) are recomputed by the API from
-- the dates on its first run, so they are not backfilled here.
UPDATE "payments" SET "paid_at" = "created_at" WHERE "status" = 'SUCCESS';

UPDATE "payments" p SET "subscription_id" = s."id"
FROM "subscriptions" s
WHERE p."studio_id" = s."studio_id" AND p."purpose" = 'SUBSCRIPTION';

UPDATE "payments" p SET "plan_id" = pl."id", "cycle" = (p."meta"->>'cycle')::"BillingCycle"
FROM "plans" pl
WHERE p."purpose" = 'SUBSCRIPTION' AND pl."code"::text = p."meta"->>'planCode' AND p."meta"->>'cycle' IN ('MONTHLY', 'YEARLY');

UPDATE "subscriptions" s SET "amount_paid" = last."amount"
FROM (
  SELECT DISTINCT ON ("subscription_id") "subscription_id", "amount"
  FROM "payments"
  WHERE "purpose" = 'SUBSCRIPTION' AND "status" = 'SUCCESS' AND "subscription_id" IS NOT NULL
  ORDER BY "subscription_id", "created_at" DESC
) last
WHERE s."id" = last."subscription_id" AND NOT s."is_trial";

UPDATE "subscriptions"
SET "anchor_day" = EXTRACT(DAY FROM ("current_period_start" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'))::int
WHERE NOT "is_trial";
