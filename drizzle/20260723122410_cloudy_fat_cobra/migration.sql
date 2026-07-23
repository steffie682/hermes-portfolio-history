DROP POLICY "ledger_events_owner_isolation" ON "ledger_events";--> statement-breakpoint
CREATE POLICY "ledger_events_owner_select" ON "ledger_events" AS PERMISSIVE FOR SELECT TO public USING ("ledger_events"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
CREATE POLICY "ledger_events_owner_insert" ON "ledger_events" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("ledger_events"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));--> statement-breakpoint
-- Custom security hardening: Drizzle does not generate FORCE RLS or runtime-role privileges.
ALTER TABLE "ledger_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portfolio_app') THEN
    REVOKE UPDATE, DELETE ON "ledger_events" FROM portfolio_app;
    GRANT SELECT, INSERT ON "ledger_events" TO portfolio_app;
  END IF;
END
$$;
