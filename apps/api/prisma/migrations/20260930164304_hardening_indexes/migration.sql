-- CreateIndex
CREATE INDEX "albums_studio_id_updated_at_idx" ON "albums"("studio_id", "updated_at");

-- CreateIndex
CREATE INDEX "clients_studio_id_phone_idx" ON "clients"("studio_id", "phone");

-- CreateIndex
CREATE INDEX "events_studio_id_created_at_idx" ON "events"("studio_id", "created_at");

-- CreateIndex
CREATE INDEX "invoices_studio_id_issue_date_idx" ON "invoices"("studio_id", "issue_date");

-- CreateIndex
CREATE INDEX "payments_studio_id_purpose_idx" ON "payments"("studio_id", "purpose");

-- CreateIndex
CREATE INDEX "selections_studio_id_deadline_idx" ON "selections"("studio_id", "deadline");

-- CreateIndex
CREATE INDEX "tickets_studio_id_last_activity_at_idx" ON "tickets"("studio_id", "last_activity_at");

-- CreateIndex
CREATE INDEX "whatsapp_messages_studio_id_template_key_created_at_idx" ON "whatsapp_messages"("studio_id", "template_key", "created_at");
