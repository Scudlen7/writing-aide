CREATE TABLE "ai_debate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"document_id" uuid,
	"submission_id" uuid,
	"version" integer NOT NULL,
	"language" text NOT NULL,
	"topic" text NOT NULL,
	"anchor" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_debate_one_target" CHECK (num_nonnulls("ai_debate"."document_id", "ai_debate"."submission_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "ai_debate_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"debate_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"role" integer NOT NULL,
	"question" text NOT NULL,
	"body" text,
	"state" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_debate_step_debate_id_round_role_unique" UNIQUE("debate_id","round","role")
);
--> statement-breakpoint
CREATE TABLE "personal_ai_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"task" text NOT NULL,
	"source" text NOT NULL,
	"digest" text NOT NULL,
	"result" jsonb NOT NULL,
	"decisions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_ai_review_document_id_version_task_digest_unique" UNIQUE("document_id","version","task","digest")
);
--> statement-breakpoint
ALTER TABLE "assignment" ADD COLUMN "ai_debate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_debate" ADD CONSTRAINT "ai_debate_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_debate" ADD CONSTRAINT "ai_debate_document_id_personal_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."personal_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_debate" ADD CONSTRAINT "ai_debate_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_debate_step" ADD CONSTRAINT "ai_debate_step_debate_id_ai_debate_id_fk" FOREIGN KEY ("debate_id") REFERENCES "public"."ai_debate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_ai_review" ADD CONSTRAINT "personal_ai_review_document_id_personal_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."personal_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_debate_owner_id_created_at_index" ON "ai_debate" USING btree ("owner_id","created_at");