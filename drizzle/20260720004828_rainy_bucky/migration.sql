CREATE TABLE "device_enrollment_grants" (
	"token_hash" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"challenge" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "device_enrollment_grants_expires_at_idx" ON "device_enrollment_grants" ("expires_at");--> statement-breakpoint
ALTER TABLE "device_enrollment_grants" ADD CONSTRAINT "device_enrollment_grants_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
REVOKE ALL ON "device_enrollment_grants" FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portfolio_app') THEN
		GRANT SELECT, INSERT, DELETE ON "device_enrollment_grants" TO portfolio_app;
	END IF;
END
$$;