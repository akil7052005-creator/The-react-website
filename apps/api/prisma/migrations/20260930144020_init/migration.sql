-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'STAFF', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('WEDDING', 'PRE_WEDDING', 'RECEPTION', 'ENGAGEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('UPCOMING', 'IN_PROGRESS', 'AWAITING_SELECTION', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SelectionStatus" AS ENUM ('DRAFT', 'SENT', 'IN_PROGRESS', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "AlbumStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('COMMENT', 'APPROVAL');

-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('STARTER', 'PRO', 'STUDIO', 'ALL_ACCESS');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('SUBSCRIPTION', 'CREDIT_PACK');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "CreditReason" AS ENUM ('PURCHASE', 'MESSAGE', 'PLAN_GRANT', 'SIGNUP_BONUS', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('UPI', 'CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'REWARDED');

-- CreateEnum
CREATE TYPE "WalletReason" AS ENUM ('REFERRAL_REWARD', 'REFERRAL_WELCOME', 'REDEMPTION', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BannerPlacement" AS ENUM ('GALLERY_HERO', 'WEBSITE_HERO', 'WEBSITE_POPUP');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('GENERAL', 'BILLING', 'TECHNICAL', 'ACCOUNT', 'FEATURE_REQUEST');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('PHOTO', 'LOGO', 'BANNER', 'ATTACHMENT');

-- CreateTable
CREATE TABLE "studios" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state_code" TEXT,
    "pincode" TEXT,
    "website" TEXT,
    "bio" TEXT,
    "logo_file_id" UUID,
    "referral_code" TEXT NOT NULL,
    "wallet_balance" INTEGER NOT NULL DEFAULT 0,
    "credit_balance" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "studio_id" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counters" (
    "studio_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("studio_id","key")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "kind" "FileKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "city" TEXT,
    "state_code" TEXT,
    "gstin" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "date" DATE NOT NULL,
    "venue" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "guests" INTEGER,
    "status" "EventStatus" NOT NULL DEFAULT 'UPCOMING',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "selection_id" UUID,
    "file_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "selections" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "quota" INTEGER NOT NULL,
    "deadline" DATE NOT NULL,
    "status" "SelectionStatus" NOT NULL DEFAULT 'DRAFT',
    "public_token" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "last_reminded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "selection_members" (
    "id" UUID NOT NULL,
    "selection_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "selection_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_picks" (
    "id" UUID NOT NULL,
    "selection_id" UUID NOT NULL,
    "photo_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_picks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_comments" (
    "id" UUID NOT NULL,
    "selection_id" UUID NOT NULL,
    "photo_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "albums" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "location" TEXT,
    "status" "AlbumStatus" NOT NULL DEFAULT 'DRAFT',
    "hue" INTEGER NOT NULL DEFAULT 345,
    "public_token" TEXT NOT NULL,
    "cover_photo_id" UUID,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "albums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "album_pages" (
    "id" UUID NOT NULL,
    "album_id" UUID NOT NULL,
    "photo_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "caption" TEXT,

    CONSTRAINT "album_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "album_feedback" (
    "id" UUID NOT NULL,
    "album_id" UUID NOT NULL,
    "spread_index" INTEGER NOT NULL,
    "kind" "FeedbackKind" NOT NULL DEFAULT 'COMMENT',
    "author_name" TEXT NOT NULL,
    "message" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "album_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" "PlanCode" NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "monthly_price" INTEGER,
    "yearly_price" INTEGER NOT NULL,
    "limits" JSONB NOT NULL,
    "features" JSONB NOT NULL,
    "popular" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "cycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_trial" BOOLEAN NOT NULL DEFAULT false,
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "CreditReason" NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "credit_cost" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "template_key" TEXT NOT NULL,
    "to_name" TEXT NOT NULL,
    "to_phone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "event_id" UUID,
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "place_of_supply" TEXT NOT NULL,
    "supplier_state" TEXT,
    "subtotal" INTEGER NOT NULL,
    "cgst" INTEGER NOT NULL,
    "sgst" INTEGER NOT NULL,
    "igst" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "amount_paid" INTEGER NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "paid_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "sac" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "rate" INTEGER NOT NULL,
    "gst_rate" INTEGER NOT NULL,
    "taxable" INTEGER NOT NULL,
    "tax" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_payments" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "paid_on" DATE NOT NULL,
    "reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "referrer_studio_id" UUID NOT NULL,
    "referred_studio_id" UUID NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "reward_amount" INTEGER NOT NULL,
    "rewarded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_txns" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "WalletReason" NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "ref_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_txns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_settings" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "sections" JSONB NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'Ivory Classic',
    "primary_color" TEXT NOT NULL DEFAULT '#8B1E3F',
    "font" TEXT NOT NULL DEFAULT 'Playfair Display',
    "tagline" TEXT,
    "custom_domain" TEXT,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "video_url" TEXT,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "event_date" DATE,
    "city" TEXT,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banners" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "placement" "BannerPlacement" NOT NULL,
    "cta_text" TEXT,
    "cta_url" TEXT,
    "image_file_id" UUID NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faqs" (
    "id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "helpful_yes" INTEGER NOT NULL DEFAULT 0,
    "helpful_no" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faq_feedback" (
    "id" UUID NOT NULL,
    "faq_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faq_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" "TicketCategory" NOT NULL,
    "priority" "TicketPriority" NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "attachment_file_id" UUID,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "from_support" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "attachment_file_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "studio_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'bell',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "studios_slug_key" ON "studios"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "studios_logo_file_id_key" ON "studios"("logo_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "studios_referral_code_key" ON "studios"("referral_code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_studio_id_idx" ON "users"("studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_resets_token_hash_key" ON "password_resets"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE INDEX "files_studio_id_kind_idx" ON "files"("studio_id", "kind");

-- CreateIndex
CREATE INDEX "files_studio_id_checksum_idx" ON "files"("studio_id", "checksum");

-- CreateIndex
CREATE INDEX "clients_studio_id_name_idx" ON "clients"("studio_id", "name");

-- CreateIndex
CREATE INDEX "events_studio_id_date_idx" ON "events"("studio_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "events_studio_id_code_key" ON "events"("studio_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "photos_file_id_key" ON "photos"("file_id");

-- CreateIndex
CREATE INDEX "photos_selection_id_position_idx" ON "photos"("selection_id", "position");

-- CreateIndex
CREATE INDEX "photos_event_id_idx" ON "photos"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "selections_public_token_key" ON "selections"("public_token");

-- CreateIndex
CREATE INDEX "selections_studio_id_status_idx" ON "selections"("studio_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "selections_studio_id_code_key" ON "selections"("studio_id", "code");

-- CreateIndex
CREATE INDEX "selection_members_selection_id_idx" ON "selection_members"("selection_id");

-- CreateIndex
CREATE INDEX "photo_picks_selection_id_idx" ON "photo_picks"("selection_id");

-- CreateIndex
CREATE UNIQUE INDEX "photo_picks_photo_id_member_id_key" ON "photo_picks"("photo_id", "member_id");

-- CreateIndex
CREATE INDEX "photo_comments_selection_id_idx" ON "photo_comments"("selection_id");

-- CreateIndex
CREATE UNIQUE INDEX "albums_public_token_key" ON "albums"("public_token");

-- CreateIndex
CREATE INDEX "albums_studio_id_status_idx" ON "albums"("studio_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "albums_studio_id_code_key" ON "albums"("studio_id", "code");

-- CreateIndex
CREATE INDEX "album_pages_album_id_position_idx" ON "album_pages"("album_id", "position");

-- CreateIndex
CREATE INDEX "album_feedback_album_id_spread_index_idx" ON "album_feedback"("album_id", "spread_index");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_studio_id_key" ON "subscriptions"("studio_id");

-- CreateIndex
CREATE INDEX "payments_studio_id_created_at_idx" ON "payments"("studio_id", "created_at");

-- CreateIndex
CREATE INDEX "credit_ledger_studio_id_created_at_idx" ON "credit_ledger"("studio_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_key_key" ON "whatsapp_templates"("key");

-- CreateIndex
CREATE INDEX "whatsapp_messages_studio_id_created_at_idx" ON "whatsapp_messages"("studio_id", "created_at");

-- CreateIndex
CREATE INDEX "invoices_studio_id_status_due_date_idx" ON "invoices"("studio_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_studio_id_number_key" ON "invoices"("studio_id", "number");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "milestones_invoice_id_idx" ON "milestones"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_payments_invoice_id_idx" ON "invoice_payments"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referred_studio_id_key" ON "referrals"("referred_studio_id");

-- CreateIndex
CREATE INDEX "referrals_referrer_studio_id_idx" ON "referrals"("referrer_studio_id");

-- CreateIndex
CREATE INDEX "wallet_txns_studio_id_created_at_idx" ON "wallet_txns"("studio_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_txns_studio_id_reason_ref_id_key" ON "wallet_txns"("studio_id", "reason", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "website_settings_studio_id_key" ON "website_settings"("studio_id");

-- CreateIndex
CREATE INDEX "leads_studio_id_created_at_idx" ON "leads"("studio_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "banners_image_file_id_key" ON "banners"("image_file_id");

-- CreateIndex
CREATE INDEX "banners_studio_id_position_idx" ON "banners"("studio_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "faq_feedback_faq_id_user_id_key" ON "faq_feedback"("faq_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_attachment_file_id_key" ON "tickets"("attachment_file_id");

-- CreateIndex
CREATE INDEX "tickets_studio_id_status_idx" ON "tickets"("studio_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_studio_id_code_key" ON "tickets"("studio_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_messages_attachment_file_id_key" ON "ticket_messages"("attachment_file_id");

-- CreateIndex
CREATE INDEX "ticket_messages_ticket_id_created_at_idx" ON "ticket_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_studio_id_read_at_created_at_idx" ON "notifications"("studio_id", "read_at", "created_at");

-- AddForeignKey
ALTER TABLE "studios" ADD CONSTRAINT "studios_logo_file_id_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counters" ADD CONSTRAINT "counters_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_selection_id_fkey" FOREIGN KEY ("selection_id") REFERENCES "selections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selections" ADD CONSTRAINT "selections_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selections" ADD CONSTRAINT "selections_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selection_members" ADD CONSTRAINT "selection_members_selection_id_fkey" FOREIGN KEY ("selection_id") REFERENCES "selections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_picks" ADD CONSTRAINT "photo_picks_selection_id_fkey" FOREIGN KEY ("selection_id") REFERENCES "selections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_picks" ADD CONSTRAINT "photo_picks_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_picks" ADD CONSTRAINT "photo_picks_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "selection_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_comments" ADD CONSTRAINT "photo_comments_selection_id_fkey" FOREIGN KEY ("selection_id") REFERENCES "selections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_comments" ADD CONSTRAINT "photo_comments_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_comments" ADD CONSTRAINT "photo_comments_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "selection_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "albums" ADD CONSTRAINT "albums_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "albums" ADD CONSTRAINT "albums_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_pages" ADD CONSTRAINT "album_pages_album_id_fkey" FOREIGN KEY ("album_id") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_pages" ADD CONSTRAINT "album_pages_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_feedback" ADD CONSTRAINT "album_feedback_album_id_fkey" FOREIGN KEY ("album_id") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_studio_id_fkey" FOREIGN KEY ("referrer_studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_studio_id_fkey" FOREIGN KEY ("referred_studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_txns" ADD CONSTRAINT "wallet_txns_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_settings" ADD CONSTRAINT "website_settings_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banners" ADD CONSTRAINT "banners_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banners" ADD CONSTRAINT "banners_image_file_id_fkey" FOREIGN KEY ("image_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faq_feedback" ADD CONSTRAINT "faq_feedback_faq_id_fkey" FOREIGN KEY ("faq_id") REFERENCES "faqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faq_feedback" ADD CONSTRAINT "faq_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_attachment_file_id_fkey" FOREIGN KEY ("attachment_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_attachment_file_id_fkey" FOREIGN KEY ("attachment_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
