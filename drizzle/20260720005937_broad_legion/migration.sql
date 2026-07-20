ALTER TABLE "auth_sessions" ADD COLUMN "auth_method" text;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "authenticated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "device_enrollment_grants" ADD COLUMN "source_session_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "device_enrollment_grants" ADD COLUMN "purpose" text NOT NULL;--> statement-breakpoint
CREATE INDEX "device_enrollment_grants_user_id_idx" ON "device_enrollment_grants" ("user_id");--> statement-breakpoint
CREATE INDEX "device_enrollment_grants_source_session_id_idx" ON "device_enrollment_grants" ("source_session_id");--> statement-breakpoint
ALTER TABLE "device_enrollment_grants" ADD CONSTRAINT "device_enrollment_grants_QTbvoPT1uncR_fkey" FOREIGN KEY ("source_session_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "device_enrollment_grants" ADD CONSTRAINT "device_enrollment_grants_purpose_check" CHECK ("purpose" = 'add_device');