ALTER TABLE "ai_debate_step" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "office_session" ADD COLUMN "pending_at" timestamp with time zone;