CREATE TABLE "management_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"target_id" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" text NOT NULL,
	"assignment_id" uuid NOT NULL,
	"submission_id" uuid,
	"kind" text NOT NULL,
	"event_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notification_recipient_id_event_key_unique" UNIQUE("recipient_id","event_key")
);
--> statement-breakpoint
ALTER TABLE "ai_review" ADD COLUMN "source" jsonb;--> statement-breakpoint
ALTER TABLE "assignment" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assignment" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "classroom" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollment" ADD COLUMN "removed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "opened_stage" text DEFAULT 'goals' NOT NULL;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "requirements" jsonb;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "submission_notifications" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "management_audit" ADD CONSTRAINT "management_audit_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_recipient_id_created_at_index" ON "notification" USING btree ("recipient_id","created_at");
--> statement-breakpoint
UPDATE "submission"
SET "opened_stage" = CASE
    WHEN "stage" = 'revise' AND btrim(coalesce("work"->>'reflection', '')) <> '' THEN 'reflect'
    ELSE "stage"
END,
"work" = CASE WHEN "stage" IN ('revise', 'reflect') OR "status" <> 'draft'
    THEN "work" || jsonb_build_object('revisionTitle', "work"->>'title')
    ELSE "work"
END;
--> statement-breakpoint
UPDATE "submission" AS s
SET "requirements" = jsonb_build_object(
    'title', a.title, 'instructions', a.instructions, 'language', a.language,
    'dueAt', a.due_at, 'minLength', a.min_length, 'maxLength', a.max_length,
    'checklist', a.checklist, 'rubric', a.rubric
)
FROM "assignment" AS a
WHERE s.assignment_id = a.id AND s.status <> 'draft';
