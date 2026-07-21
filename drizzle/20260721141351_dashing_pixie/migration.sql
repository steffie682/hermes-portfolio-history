CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"broker_account_id" uuid NOT NULL,
	"source_document_id" uuid NOT NULL,
	"parser_name" text NOT NULL,
	"parser_version" text NOT NULL,
	"status" text NOT NULL,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_status_check" CHECK ("status" IN ('preview_ready', 'committed', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "import_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ledger_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"broker_account_id" uuid NOT NULL,
	"staged_event_id" uuid NOT NULL UNIQUE,
	"fingerprint" text NOT NULL,
	"event_kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_events_fingerprint_check" CHECK (char_length("fingerprint") = 64 AND "fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "ledger_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "private_source_objects" (
	"id" uuid PRIMARY KEY,
	"owner_user_id" text NOT NULL,
	"broker_account_id" uuid NOT NULL,
	"storage_key" text NOT NULL UNIQUE,
	"status" text NOT NULL,
	"cleanup_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_source_objects_status_check" CHECK ("status" IN ('pending_upload', 'retained', 'cleanup_pending')),
	CONSTRAINT "private_source_objects_cleanup_attempts_check" CHECK ("cleanup_attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "private_source_objects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"broker_account_id" uuid NOT NULL,
	"content_sha256" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"document_type" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_documents_sha256_check" CHECK (char_length("content_sha256") = 64 AND "content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "source_documents_byte_size_check" CHECK ("byte_size" BETWEEN 1 AND 10485760),
	CONSTRAINT "source_documents_type_check" CHECK ("document_type" = 'sbi_trade_history_csv'),
	CONSTRAINT "source_documents_status_check" CHECK ("status" IN ('stored', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "source_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"batch_id" uuid NOT NULL,
	"source_document_id" uuid NOT NULL,
	"locator" text NOT NULL,
	"source_page" integer,
	"source_row" integer NOT NULL,
	"record_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_records_row_check" CHECK ("source_row" > 0),
	CONSTRAINT "source_records_sha256_check" CHECK (char_length("record_sha256") = 64 AND "record_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "source_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staged_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"broker_account_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"source_record_id" uuid NOT NULL,
	"status" text NOT NULL,
	"reason_code" text,
	"event_kind" text,
	"fingerprint" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staged_events_status_check" CHECK ("status" IN ('new', 'needs_review', 'duplicate', 'rejected')),
	CONSTRAINT "staged_events_fingerprint_check" CHECK (char_length("fingerprint") = 64 AND "fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "staged_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "broker_accounts_owner_id_uidx" ON "broker_accounts" ("owner_user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_owner_id_uidx" ON "import_batches" ("owner_user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_owner_account_id_uidx" ON "import_batches" ("owner_user_id","broker_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_owner_id_source_uidx" ON "import_batches" ("owner_user_id","id","source_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_owner_source_uidx" ON "import_batches" ("owner_user_id","source_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_events_owner_fingerprint_uidx" ON "ledger_events" ("owner_user_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "private_source_objects_owner_id_uidx" ON "private_source_objects" ("owner_user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "private_source_objects_owner_id_key_uidx" ON "private_source_objects" ("owner_user_id","id","storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "private_source_objects_owner_account_id_key_uidx" ON "private_source_objects" ("owner_user_id","broker_account_id","id","storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "source_documents_owner_id_uidx" ON "source_documents" ("owner_user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_documents_owner_account_id_uidx" ON "source_documents" ("owner_user_id","broker_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_documents_owner_account_sha256_uidx" ON "source_documents" ("owner_user_id","broker_account_id","content_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "source_records_owner_id_uidx" ON "source_records" ("owner_user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_records_owner_id_batch_uidx" ON "source_records" ("owner_user_id","id","batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_records_document_locator_uidx" ON "source_records" ("source_document_id","locator");--> statement-breakpoint
CREATE UNIQUE INDEX "staged_events_owner_id_uidx" ON "staged_events" ("owner_user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "staged_events_owner_account_id_uidx" ON "staged_events" ("owner_user_id","broker_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "staged_events_batch_source_uidx" ON "staged_events" ("batch_id","source_record_id");--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_owner_broker_account_fk" FOREIGN KEY ("owner_user_id","broker_account_id") REFERENCES "broker_accounts"("owner_user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_owner_account_source_document_fk" FOREIGN KEY ("owner_user_id","broker_account_id","source_document_id") REFERENCES "source_documents"("owner_user_id","broker_account_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_owner_broker_account_fk" FOREIGN KEY ("owner_user_id","broker_account_id") REFERENCES "broker_accounts"("owner_user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_owner_account_staged_event_fk" FOREIGN KEY ("owner_user_id","broker_account_id","staged_event_id") REFERENCES "staged_events"("owner_user_id","broker_account_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "private_source_objects" ADD CONSTRAINT "private_source_objects_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "private_source_objects" ADD CONSTRAINT "private_source_objects_owner_broker_account_fk" FOREIGN KEY ("owner_user_id","broker_account_id") REFERENCES "broker_accounts"("owner_user_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_owner_broker_account_fk" FOREIGN KEY ("owner_user_id","broker_account_id") REFERENCES "broker_accounts"("owner_user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_owner_account_storage_object_fk" FOREIGN KEY ("owner_user_id","broker_account_id","id","storage_key") REFERENCES "private_source_objects"("owner_user_id","broker_account_id","id","storage_key") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_owner_batch_source_document_fk" FOREIGN KEY ("owner_user_id","batch_id","source_document_id") REFERENCES "import_batches"("owner_user_id","id","source_document_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "staged_events" ADD CONSTRAINT "staged_events_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "staged_events" ADD CONSTRAINT "staged_events_owner_account_batch_fk" FOREIGN KEY ("owner_user_id","broker_account_id","batch_id") REFERENCES "import_batches"("owner_user_id","broker_account_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "staged_events" ADD CONSTRAINT "staged_events_owner_record_batch_fk" FOREIGN KEY ("owner_user_id","source_record_id","batch_id") REFERENCES "source_records"("owner_user_id","id","batch_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "import_batches_owner_isolation" ON "import_batches" AS PERMISSIVE FOR ALL TO public USING ("import_batches"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')) WITH CHECK ("import_batches"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "ledger_events_owner_isolation" ON "ledger_events" AS PERMISSIVE FOR ALL TO public USING ("ledger_events"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')) WITH CHECK ("ledger_events"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "private_source_objects_owner_isolation" ON "private_source_objects" AS PERMISSIVE FOR ALL TO public USING ("private_source_objects"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')) WITH CHECK ("private_source_objects"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "source_documents_owner_isolation" ON "source_documents" AS PERMISSIVE FOR ALL TO public USING ("source_documents"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')) WITH CHECK ("source_documents"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "source_records_owner_isolation" ON "source_records" AS PERMISSIVE FOR ALL TO public USING ("source_records"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')) WITH CHECK ("source_records"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "staged_events_owner_isolation" ON "staged_events" AS PERMISSIVE FOR ALL TO public USING ("staged_events"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')) WITH CHECK ("staged_events"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));
--> statement-breakpoint
ALTER TABLE "private_source_objects" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "source_documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "import_batches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "source_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "staged_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ledger_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "private_source_objects" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON "source_documents" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON "import_batches" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON "source_records" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON "staged_events" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON "ledger_events" FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portfolio_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "private_source_objects", "source_documents", "import_batches", "source_records", "staged_events", "ledger_events" TO portfolio_app;
  END IF;
END
$$;
