CREATE TABLE "garden_states" (
	"owner_user_id" text PRIMARY KEY,
	"revision" integer NOT NULL,
	"lots" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "garden_states_revision_check" CHECK ("revision" BETWEEN 1 AND 2147483646),
	CONSTRAINT "garden_states_lots_check" CHECK (CASE WHEN jsonb_typeof("lots") = 'array' THEN jsonb_array_length("lots") <= 200 ELSE false END)
);
--> statement-breakpoint
ALTER TABLE "garden_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "garden_states" ADD CONSTRAINT "garden_states_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "garden_states_owner_isolation" ON "garden_states" AS PERMISSIVE FOR ALL TO public USING ("garden_states"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')) WITH CHECK ("garden_states"."owner_user_id" = nullif(current_setting('app.current_user_id', true), ''));
--> statement-breakpoint
-- Custom security suffix: Drizzle models the policy; runtime ACL/FORCE are maintained here.
ALTER TABLE public.garden_states FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.garden_states FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portfolio_app') THEN
    REVOKE ALL ON public.garden_states FROM portfolio_app;
    GRANT SELECT, INSERT, UPDATE ON public.garden_states TO portfolio_app;
  END IF;
END $$;
