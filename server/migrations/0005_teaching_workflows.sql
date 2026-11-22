CREATE TABLE "ai_request_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task" text NOT NULL,
	"model" text NOT NULL,
	"outcome" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "peer_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"submission_version" integer NOT NULL,
	"status" text DEFAULT 'assigned' NOT NULL,
	"feedback" jsonb,
	"report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peer_review_submission_id_reviewer_id_submission_version_unique" UNIQUE("submission_id","reviewer_id","submission_version")
);
--> statement-breakpoint
ALTER TABLE "ai_review" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_review" ADD COLUMN "calibration" jsonb;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "returned" jsonb;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "prior_grade_draft" jsonb;--> statement-breakpoint
ALTER TABLE "peer_review" ADD CONSTRAINT "peer_review_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_review" ADD CONSTRAINT "peer_review_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_request_event_created_at_index" ON "ai_request_event" USING btree ("created_at");