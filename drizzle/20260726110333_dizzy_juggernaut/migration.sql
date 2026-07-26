CREATE TABLE "full_balance_report_cash_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"broker_account_id" uuid NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"section_kind" text NOT NULL,
	"source_kind" text NOT NULL,
	"amount" numeric(20,2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "full_balance_report_cash_rows_bounds_check" CHECK ("row_index" BETWEEN 1 AND 100),
	CONSTRAINT "full_balance_report_cash_rows_kind_check" CHECK (
      ("section_kind" = 'deposits' AND "source_kind" = 'cash_deposit') OR
      ("section_kind" = 'collateral' AND "source_kind" IN
        ('margin_guarantee', 'stock_lending_collateral', 'futures_options_margin'))),
	CONSTRAINT "full_balance_report_cash_rows_amount_check" CHECK ("amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "full_balance_report_cash_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "full_balance_report_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"broker_account_id" uuid NOT NULL,
	"statement_date" date NOT NULL,
	"source_page_count" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"generic_as_of" boolean NOT NULL,
	"manually_confirmed" boolean NOT NULL,
	"all_relevant_pages_reviewed" boolean NOT NULL,
	"fingerprint_version" integer NOT NULL,
	"deposit_count" integer NOT NULL,
	"collateral_count" integer NOT NULL,
	"domestic_stock_lot_count" integer NOT NULL,
	"fund_balance_count" integer NOT NULL,
	"margin_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "full_balance_report_checkpoints_evidence_check" CHECK (
      "generic_as_of" AND "manually_confirmed" AND
      "all_relevant_pages_reviewed" AND "fingerprint_version" = 2),
	CONSTRAINT "full_balance_report_checkpoints_fingerprint_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "full_balance_report_checkpoints_counts_check" CHECK (
      "deposit_count" BETWEEN 0 AND 100 AND
      "collateral_count" BETWEEN 0 AND 100 AND
      "domestic_stock_lot_count" BETWEEN 0 AND 100 AND
      "fund_balance_count" BETWEEN 0 AND 100 AND
      "margin_count" BETWEEN 0 AND 100)
	,CONSTRAINT "full_balance_report_checkpoints_source_page_count_check" CHECK ("source_page_count" BETWEEN 1 AND 100)
);
--> statement-breakpoint
ALTER TABLE "full_balance_report_checkpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "full_balance_report_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"broker_account_id" uuid NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"section_kind" text NOT NULL,
	"entry_kind" text NOT NULL,
	"row_index" integer,
	"source_page" integer NOT NULL,
	"source_row" integer NOT NULL,
	CONSTRAINT "full_balance_report_entries_shape_check" CHECK (
      "source_page" BETWEEN 1 AND 100 AND "source_row" BETWEEN 1 AND 100 AND
      (("entry_kind" = 'zero' AND "row_index" IS NULL) OR
       ("entry_kind" = 'row' AND "row_index" BETWEEN 1 AND 100)))
);
--> statement-breakpoint
ALTER TABLE "full_balance_report_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "full_balance_report_fund_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"broker_account_id" uuid NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"section_kind" text NOT NULL,
	"row_index" integer NOT NULL,
	"security_code" text NOT NULL,
	"security_name" text NOT NULL,
	"units" numeric(24,6) NOT NULL,
	"reference_price" numeric(24,6) NOT NULL,
	"evaluation_amount" numeric(20,2) NOT NULL,
	"reference_price_unit" numeric(24,6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "full_balance_report_fund_balances_bounds_check" CHECK ("row_index" BETWEEN 1 AND 100),
	CONSTRAINT "full_balance_report_fund_balances_code_check" CHECK ("security_code" ~ '^(?:[0-9][0-9A-HJ-NP-UW-Y][0-9][0-9A-HJ-NP-UW-Y]|[0-9]{3}\.[0-9]{2})$'),
	CONSTRAINT "full_balance_report_fund_balances_values_check" CHECK (
      char_length("security_name") BETWEEN 1 AND 100 AND "units" > 0 AND
      "reference_price" > 0 AND "evaluation_amount" > 0 AND
      ("reference_price_unit" IS NULL OR "reference_price_unit" > 0)),
	CONSTRAINT "full_balance_report_fund_balances_section_check" CHECK ("section_kind" = 'fundBalances')
);
--> statement-breakpoint
ALTER TABLE "full_balance_report_fund_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "full_balance_report_margin_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"broker_account_id" uuid NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"section_kind" text NOT NULL,
	"row_index" integer NOT NULL,
	"state" text NOT NULL,
	"security_code" text NOT NULL,
	"security_name" text NOT NULL,
	"quantity" numeric(24,6) NOT NULL,
	"market" text NOT NULL,
	"side" text NOT NULL,
	"contract_date" date NOT NULL,
	"contract_unit_price" numeric(24,6) NOT NULL,
	"current_price" numeric(24,6),
	"fees" numeric(20,2),
	"unrealized_pnl" numeric(20,2),
	"final_repayment_due_date" date,
	"settlement_contract_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "full_balance_report_margin_rows_bounds_check" CHECK ("row_index" BETWEEN 1 AND 100),
	CONSTRAINT "full_balance_report_margin_rows_code_check" CHECK ("security_code" ~ '^(?:[0-9][0-9A-HJ-NP-UW-Y][0-9][0-9A-HJ-NP-UW-Y]|[0-9]{3}\.[0-9]{2})$'),
	CONSTRAINT "full_balance_report_margin_rows_values_check" CHECK (
      char_length("security_name") BETWEEN 1 AND 100 AND
      "market" IN ('tokyo','private','nagoya','fukuoka','sapporo') AND
      "quantity" > 0 AND "contract_unit_price" > 0 AND "side" IN ('buy', 'sell') AND
      ("current_price" IS NULL OR "current_price" > 0) AND
      ("fees" IS NULL OR "fees" >= 0) AND
      "state" = 'open' AND "final_repayment_due_date" IS NOT NULL AND
      "settlement_contract_date" IS NULL AND "final_repayment_due_date" >= "contract_date"),
	CONSTRAINT "full_balance_report_margin_rows_section_check" CHECK ("section_kind" = 'margin')
);
--> statement-breakpoint
ALTER TABLE "full_balance_report_margin_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "full_balance_report_sections" (
	"owner_user_id" text NOT NULL,
	"broker_account_id" uuid NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"section_kind" text NOT NULL,
	"evidence_state" text NOT NULL,
	"declared_count" integer NOT NULL,
	CONSTRAINT "full_balance_report_sections_kind_check" CHECK ("section_kind" IN
      ('deposits','collateral','domesticStockLots','fundBalances','margin','futures','options')),
	CONSTRAINT "full_balance_report_sections_state_check" CHECK (
      ("evidence_state" = 'explicit_zero' AND "declared_count" = 0) OR
      ("evidence_state" = 'reported' AND "declared_count" BETWEEN 1 AND 100))
);
--> statement-breakpoint
ALTER TABLE "full_balance_report_sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "full_balance_report_stock_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" text NOT NULL,
	"broker_account_id" uuid NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"section_kind" text NOT NULL,
	"row_index" integer NOT NULL,
	"security_code" text NOT NULL,
	"security_name" text NOT NULL,
	"acquisition_date" date NOT NULL,
	"quantity" numeric(24,6) NOT NULL,
	"acquisition_unit_price_state" text NOT NULL,
	"purchase_amount_state" text NOT NULL,
	"acquisition_unit_price" numeric(24,6),
	"purchase_amount" numeric(20,2),
	"reference_price" numeric(24,6),
	"evaluation_amount" numeric(20,2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "full_balance_report_stock_lots_bounds_check" CHECK ("row_index" BETWEEN 1 AND 100),
	CONSTRAINT "full_balance_report_stock_lots_code_check" CHECK ("security_code" ~ '^(?:[0-9][0-9A-HJ-NP-UW-Y][0-9][0-9A-HJ-NP-UW-Y]|[0-9]{3}\.[0-9]{2})$'),
	CONSTRAINT "full_balance_report_stock_lots_values_check" CHECK (
      char_length("security_name") BETWEEN 1 AND 100 AND "quantity" > 0 AND
      (("acquisition_unit_price_state" = 'reported' AND "acquisition_unit_price" > 0) OR
       ("acquisition_unit_price_state" IN ('masked','absent') AND "acquisition_unit_price" IS NULL)) AND
      (("purchase_amount_state" = 'reported' AND "purchase_amount" > 0) OR
       ("purchase_amount_state" IN ('masked','absent') AND "purchase_amount" IS NULL)) AND
      ("reference_price" IS NULL OR "reference_price" > 0) AND
      ("evaluation_amount" IS NULL OR "evaluation_amount" > 0)),
	CONSTRAINT "full_balance_report_stock_lots_section_check" CHECK ("section_kind" = 'domesticStockLots')
);
--> statement-breakpoint
ALTER TABLE "full_balance_report_stock_lots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "full_balance_report_cash_rows_checkpoint_index_uidx" ON "full_balance_report_cash_rows" ("checkpoint_id","section_kind","row_index");--> statement-breakpoint
CREATE UNIQUE INDEX "full_balance_report_checkpoints_owner_account_id_uidx" ON "full_balance_report_checkpoints" ("owner_user_id","broker_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "full_balance_report_checkpoints_owner_fingerprint_uidx" ON "full_balance_report_checkpoints" ("owner_user_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "full_balance_report_entries_owner_account_checkpoint_entry_uidx" ON "full_balance_report_entries" ("owner_user_id","broker_account_id","checkpoint_id","section_kind","row_index","id");--> statement-breakpoint
CREATE UNIQUE INDEX "full_balance_report_entries_checkpoint_locator_uidx" ON "full_balance_report_entries" ("checkpoint_id","source_page","source_row");--> statement-breakpoint
CREATE UNIQUE INDEX "full_balance_report_entries_checkpoint_section_index_uidx" ON "full_balance_report_entries" ("checkpoint_id","section_kind","row_index");--> statement-breakpoint
CREATE UNIQUE INDEX "full_balance_report_fund_balances_checkpoint_index_uidx" ON "full_balance_report_fund_balances" ("checkpoint_id","section_kind","row_index");--> statement-breakpoint
CREATE UNIQUE INDEX "full_balance_report_margin_rows_checkpoint_index_uidx" ON "full_balance_report_margin_rows" ("checkpoint_id","section_kind","row_index");--> statement-breakpoint
CREATE UNIQUE INDEX "full_balance_report_sections_identity_uidx" ON "full_balance_report_sections" ("owner_user_id","broker_account_id","checkpoint_id","section_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "full_balance_report_stock_lots_checkpoint_index_uidx" ON "full_balance_report_stock_lots" ("checkpoint_id","section_kind","row_index");--> statement-breakpoint
ALTER TABLE "full_balance_report_cash_rows" ADD CONSTRAINT "full_balance_report_cash_rows_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "full_balance_report_cash_rows" ADD CONSTRAINT "full_balance_report_cash_rows_entry_fk" FOREIGN KEY ("owner_user_id","broker_account_id","checkpoint_id","section_kind","row_index","entry_id") REFERENCES "full_balance_report_entries"("owner_user_id","broker_account_id","checkpoint_id","section_kind","row_index","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "full_balance_report_checkpoints" ADD CONSTRAINT "full_balance_report_checkpoints_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "full_balance_report_checkpoints" ADD CONSTRAINT "full_balance_report_checkpoints_owner_broker_account_fk" FOREIGN KEY ("owner_user_id","broker_account_id") REFERENCES "broker_accounts"("owner_user_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "full_balance_report_entries" ADD CONSTRAINT "full_balance_report_entries_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "full_balance_report_entries" ADD CONSTRAINT "full_balance_report_entries_section_fk" FOREIGN KEY ("owner_user_id","broker_account_id","checkpoint_id","section_kind") REFERENCES "full_balance_report_sections"("owner_user_id","broker_account_id","checkpoint_id","section_kind") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "full_balance_report_fund_balances" ADD CONSTRAINT "full_balance_report_fund_balances_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "full_balance_report_fund_balances" ADD CONSTRAINT "full_balance_report_fund_balances_entry_fk" FOREIGN KEY ("owner_user_id","broker_account_id","checkpoint_id","section_kind","row_index","entry_id") REFERENCES "full_balance_report_entries"("owner_user_id","broker_account_id","checkpoint_id","section_kind","row_index","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "full_balance_report_margin_rows" ADD CONSTRAINT "full_balance_report_margin_rows_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "full_balance_report_margin_rows" ADD CONSTRAINT "full_balance_report_margin_rows_entry_fk" FOREIGN KEY ("owner_user_id","broker_account_id","checkpoint_id","section_kind","row_index","entry_id") REFERENCES "full_balance_report_entries"("owner_user_id","broker_account_id","checkpoint_id","section_kind","row_index","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "full_balance_report_sections" ADD CONSTRAINT "full_balance_report_sections_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "full_balance_report_sections" ADD CONSTRAINT "full_balance_report_sections_owner_account_checkpoint_fk" FOREIGN KEY ("owner_user_id","broker_account_id","checkpoint_id") REFERENCES "full_balance_report_checkpoints"("owner_user_id","broker_account_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "full_balance_report_stock_lots" ADD CONSTRAINT "full_balance_report_stock_lots_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "full_balance_report_stock_lots" ADD CONSTRAINT "full_balance_report_stock_lots_entry_fk" FOREIGN KEY ("owner_user_id","broker_account_id","checkpoint_id","section_kind","row_index","entry_id") REFERENCES "full_balance_report_entries"("owner_user_id","broker_account_id","checkpoint_id","section_kind","row_index","id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE POLICY "full_balance_report_cash_rows_owner_select" ON "full_balance_report_cash_rows" AS PERMISSIVE FOR SELECT TO public USING ("full_balance_report_cash_rows"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "full_balance_report_cash_rows_owner_insert" ON "full_balance_report_cash_rows" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("full_balance_report_cash_rows"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "full_balance_report_checkpoints_owner_select" ON "full_balance_report_checkpoints" AS PERMISSIVE FOR SELECT TO public USING ("full_balance_report_checkpoints"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "full_balance_report_checkpoints_owner_insert" ON "full_balance_report_checkpoints" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("full_balance_report_checkpoints"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "full_balance_report_entries_owner_select" ON "full_balance_report_entries" AS PERMISSIVE FOR SELECT TO public USING ("full_balance_report_entries"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "full_balance_report_entries_owner_insert" ON "full_balance_report_entries" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("full_balance_report_entries"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "full_balance_report_fund_balances_owner_select" ON "full_balance_report_fund_balances" AS PERMISSIVE FOR SELECT TO public USING ("full_balance_report_fund_balances"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "full_balance_report_fund_balances_owner_insert" ON "full_balance_report_fund_balances" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("full_balance_report_fund_balances"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "full_balance_report_margin_rows_owner_select" ON "full_balance_report_margin_rows" AS PERMISSIVE FOR SELECT TO public USING ("full_balance_report_margin_rows"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "full_balance_report_margin_rows_owner_insert" ON "full_balance_report_margin_rows" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("full_balance_report_margin_rows"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "full_balance_report_sections_owner_select" ON "full_balance_report_sections" AS PERMISSIVE FOR SELECT TO public USING ("full_balance_report_sections"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "full_balance_report_sections_owner_insert" ON "full_balance_report_sections" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("full_balance_report_sections"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "full_balance_report_stock_lots_owner_select" ON "full_balance_report_stock_lots" AS PERMISSIVE FOR SELECT TO public USING ("full_balance_report_stock_lots"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "full_balance_report_stock_lots_owner_insert" ON "full_balance_report_stock_lots" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("full_balance_report_stock_lots"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));
--> statement-breakpoint
CREATE FUNCTION public.full_balance_report_reject_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$ BEGIN
  RAISE EXCEPTION 'full balance report evidence is append-only';
END $$;
--> statement-breakpoint
CREATE FUNCTION public.full_balance_report_validate_checkpoint() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  checkpoint uuid;
  parent public.full_balance_report_checkpoints%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'full_balance_report_checkpoints' THEN
    checkpoint := NEW.id;
  ELSE
    checkpoint := NEW.checkpoint_id;
  END IF;
  SELECT * INTO parent FROM public.full_balance_report_checkpoints WHERE id = checkpoint;
  IF NOT FOUND THEN RAISE EXCEPTION 'missing checkpoint'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.full_balance_report_entries e
    WHERE e.checkpoint_id = checkpoint AND e.source_page > parent.source_page_count
  ) THEN RAISE EXCEPTION 'source page exceeds checkpoint page count'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.full_balance_report_stock_lots r
    WHERE r.checkpoint_id = checkpoint AND r.acquisition_date > parent.statement_date
    UNION ALL
    SELECT 1 FROM public.full_balance_report_margin_rows r
    WHERE r.checkpoint_id = checkpoint AND (
      r.contract_date > parent.statement_date OR
      r.final_repayment_due_date < parent.statement_date)
  ) THEN RAISE EXCEPTION 'typed row date contradicts statement evidence'; END IF;

  IF (SELECT count(*) FROM public.full_balance_report_sections WHERE checkpoint_id = checkpoint) <> 7
    OR EXISTS (
      SELECT 1 FROM full_balance_report_sections s
      WHERE s.checkpoint_id = checkpoint AND (
        (s.evidence_state = 'explicit_zero' AND (
          (SELECT count(*) FROM full_balance_report_entries e
            WHERE e.checkpoint_id = checkpoint AND e.section_kind = s.section_kind
              AND e.entry_kind = 'zero') <> 1 OR
          EXISTS (SELECT 1 FROM full_balance_report_entries e
            WHERE e.checkpoint_id = checkpoint AND e.section_kind = s.section_kind
              AND e.entry_kind = 'row')
        )) OR
        (s.evidence_state = 'reported' AND (
          (SELECT count(*) FROM full_balance_report_entries e
            WHERE e.checkpoint_id = checkpoint AND e.section_kind = s.section_kind
              AND e.entry_kind = 'row') <> s.declared_count OR
          EXISTS (SELECT 1 FROM full_balance_report_entries e
            WHERE e.checkpoint_id = checkpoint AND e.section_kind = s.section_kind
              AND e.entry_kind = 'zero')
        ))
      )
    )
  THEN RAISE EXCEPTION 'incomplete section evidence'; END IF;

  IF EXISTS (
    SELECT 1 FROM full_balance_report_entries e
    WHERE e.checkpoint_id = checkpoint AND e.entry_kind = 'row' AND
      CASE e.section_kind
        WHEN 'deposits' THEN (SELECT count(*) FROM full_balance_report_cash_rows r WHERE r.entry_id = e.id AND r.section_kind = 'deposits')
        WHEN 'collateral' THEN (SELECT count(*) FROM full_balance_report_cash_rows r WHERE r.entry_id = e.id AND r.section_kind = 'collateral')
        WHEN 'domesticStockLots' THEN (SELECT count(*) FROM full_balance_report_stock_lots r WHERE r.entry_id = e.id)
        WHEN 'fundBalances' THEN (SELECT count(*) FROM full_balance_report_fund_balances r WHERE r.entry_id = e.id)
        WHEN 'margin' THEN (SELECT count(*) FROM full_balance_report_margin_rows r WHERE r.entry_id = e.id)
        ELSE 0
      END <> 1
  ) THEN RAISE EXCEPTION 'typed row mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM full_balance_report_cash_rows r JOIN full_balance_report_entries e ON e.id = r.entry_id
      WHERE r.checkpoint_id = checkpoint AND e.entry_kind <> 'row'
    UNION ALL
    SELECT 1 FROM full_balance_report_stock_lots r JOIN full_balance_report_entries e ON e.id = r.entry_id
      WHERE r.checkpoint_id = checkpoint AND e.entry_kind <> 'row'
    UNION ALL
    SELECT 1 FROM full_balance_report_fund_balances r JOIN full_balance_report_entries e ON e.id = r.entry_id
      WHERE r.checkpoint_id = checkpoint AND e.entry_kind <> 'row'
    UNION ALL
    SELECT 1 FROM full_balance_report_margin_rows r JOIN full_balance_report_entries e ON e.id = r.entry_id
      WHERE r.checkpoint_id = checkpoint AND e.entry_kind <> 'row'
  ) THEN RAISE EXCEPTION 'typed child attached to zero evidence'; END IF;

  IF parent.deposit_count <> (SELECT count(*) FROM full_balance_report_cash_rows WHERE checkpoint_id = checkpoint AND section_kind = 'deposits')
    OR parent.collateral_count <> (SELECT count(*) FROM full_balance_report_cash_rows WHERE checkpoint_id = checkpoint AND section_kind = 'collateral')
    OR parent.domestic_stock_lot_count <> (SELECT count(*) FROM full_balance_report_stock_lots WHERE checkpoint_id = checkpoint)
    OR parent.fund_balance_count <> (SELECT count(*) FROM full_balance_report_fund_balances WHERE checkpoint_id = checkpoint)
    OR parent.margin_count <> (SELECT count(*) FROM full_balance_report_margin_rows WHERE checkpoint_id = checkpoint)
  THEN RAISE EXCEPTION 'parent count mismatch'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.full_balance_report_reject_mutation() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.full_balance_report_validate_checkpoint() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER full_balance_report_checkpoint_complete
AFTER INSERT ON public.full_balance_report_checkpoints DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.full_balance_report_validate_checkpoint();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER full_balance_report_section_complete
AFTER INSERT ON public.full_balance_report_sections DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.full_balance_report_validate_checkpoint();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER full_balance_report_entry_complete
AFTER INSERT ON public.full_balance_report_entries DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.full_balance_report_validate_checkpoint();
--> statement-breakpoint
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'full_balance_report_checkpoints','full_balance_report_sections','full_balance_report_entries',
    'full_balance_report_cash_rows','full_balance_report_stock_lots',
    'full_balance_report_fund_balances','full_balance_report_margin_rows'
  ] LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portfolio_app') THEN
      EXECUTE format('REVOKE ALL ON %I FROM portfolio_app', table_name);
      EXECUTE format('GRANT SELECT, INSERT ON %I TO portfolio_app', table_name);
    END IF;
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.full_balance_report_reject_mutation()',
      table_name || '_append_only', table_name
    );
  END LOOP;
END $$;
