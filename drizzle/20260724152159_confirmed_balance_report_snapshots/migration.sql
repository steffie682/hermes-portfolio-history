CREATE TABLE "balance_report_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"broker_account_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"position_index" integer NOT NULL,
	"source_page" integer NOT NULL,
	"side" text NOT NULL,
	"security_code" text NOT NULL,
	"security_name" text NOT NULL,
	"quantity" text NOT NULL,
	"unit_price_yen" numeric(24,6) NOT NULL,
	"opened_on" date NOT NULL,
	"due_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_report_positions_index_check" CHECK ("position_index" BETWEEN 1 AND 100),
	CONSTRAINT "balance_report_positions_source_page_check" CHECK ("source_page" BETWEEN 1 AND 100),
	CONSTRAINT "balance_report_positions_side_check" CHECK ("side" IN ('buy', 'sell')),
	CONSTRAINT "balance_report_positions_security_code_check" CHECK ("security_code" ~ '^[A-Z0-9]{4}$'),
	CONSTRAINT "balance_report_positions_security_name_check" CHECK (char_length("security_name") BETWEEN 1 AND 100),
	CONSTRAINT "balance_report_positions_quantity_check" CHECK ("quantity" ~ '^[1-9][0-9]{0,17}$'),
	CONSTRAINT "balance_report_positions_price_check" CHECK ("unit_price_yen" > 0),
	CONSTRAINT "balance_report_positions_dates_check" CHECK ("due_on" IS NULL OR "due_on" >= "opened_on")
);
--> statement-breakpoint
ALTER TABLE "balance_report_positions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "balance_report_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"broker_account_id" uuid NOT NULL,
	"statement_date" date NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text NOT NULL,
	"position_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_report_snapshots_status_check" CHECK ("status" = 'confirmed'),
	CONSTRAINT "balance_report_snapshots_position_count_check" CHECK ("position_count" BETWEEN 0 AND 100),
	CONSTRAINT "balance_report_snapshots_fingerprint_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "balance_report_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "balance_report_positions_snapshot_index_uidx" ON "balance_report_positions" ("snapshot_id","position_index");--> statement-breakpoint
CREATE UNIQUE INDEX "balance_report_snapshots_owner_account_id_uidx" ON "balance_report_snapshots" ("owner_user_id","broker_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "balance_report_snapshots_owner_fingerprint_uidx" ON "balance_report_snapshots" ("owner_user_id","fingerprint");--> statement-breakpoint
ALTER TABLE "balance_report_positions" ADD CONSTRAINT "balance_report_positions_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "balance_report_positions" ADD CONSTRAINT "balance_report_positions_owner_account_snapshot_fk" FOREIGN KEY ("owner_user_id","broker_account_id","snapshot_id") REFERENCES "balance_report_snapshots"("owner_user_id","broker_account_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "balance_report_snapshots" ADD CONSTRAINT "balance_report_snapshots_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "balance_report_snapshots" ADD CONSTRAINT "balance_report_snapshots_owner_broker_account_fk" FOREIGN KEY ("owner_user_id","broker_account_id") REFERENCES "broker_accounts"("owner_user_id","id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE POLICY "balance_report_positions_owner_select" ON "balance_report_positions" AS PERMISSIVE FOR SELECT TO public USING ("balance_report_positions"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "balance_report_positions_owner_insert" ON "balance_report_positions" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("balance_report_positions"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "balance_report_snapshots_owner_select" ON "balance_report_snapshots" AS PERMISSIVE FOR SELECT TO public USING ("balance_report_snapshots"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "balance_report_snapshots_owner_insert" ON "balance_report_snapshots" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("balance_report_snapshots"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
ALTER TABLE "balance_report_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "balance_report_positions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "balance_report_snapshots" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON "balance_report_positions" FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portfolio_app') THEN
    GRANT SELECT, INSERT ON "balance_report_snapshots", "balance_report_positions" TO portfolio_app;
  END IF;
END
$$;
