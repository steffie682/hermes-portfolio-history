ALTER TABLE "full_balance_report_checkpoints" ADD COLUMN "unresolved_section_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "full_balance_report_checkpoints" DROP CONSTRAINT "full_balance_report_checkpoints_counts_check", ADD CONSTRAINT "full_balance_report_checkpoints_counts_check" CHECK (
      "deposit_count" BETWEEN 0 AND 100 AND
      "collateral_count" BETWEEN 0 AND 100 AND
      "domestic_stock_lot_count" BETWEEN 0 AND 100 AND
      "fund_balance_count" BETWEEN 0 AND 100 AND
      "margin_count" BETWEEN 0 AND 100 AND
      "unresolved_section_count" BETWEEN 0 AND 5);--> statement-breakpoint
ALTER TABLE "full_balance_report_sections" DROP CONSTRAINT "full_balance_report_sections_state_check", ADD CONSTRAINT "full_balance_report_sections_state_check" CHECK (
      ("evidence_state" = 'explicit_zero' AND "declared_count" = 0) OR
      ("evidence_state" = 'missing' AND "declared_count" = 0 AND "section_kind" NOT IN ('futures','options')) OR
      ("evidence_state" = 'reported' AND "declared_count" BETWEEN 1 AND 100));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.full_balance_report_validate_checkpoint() RETURNS trigger
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
    WHERE r.checkpoint_id = checkpoint AND r.contract_date > parent.statement_date
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
        )) OR
        (s.evidence_state = 'missing' AND EXISTS (
          SELECT 1 FROM full_balance_report_entries e
          WHERE e.checkpoint_id = checkpoint AND e.section_kind = s.section_kind
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
    OR parent.unresolved_section_count <> (SELECT count(*) FROM full_balance_report_sections
      WHERE checkpoint_id = checkpoint AND evidence_state = 'missing')
  THEN RAISE EXCEPTION 'parent count mismatch'; END IF;
  RETURN NULL;
END $$;
