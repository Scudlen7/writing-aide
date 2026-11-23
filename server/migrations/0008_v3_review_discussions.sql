CREATE TABLE "review_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"role" text,
	"reply_to" uuid,
	"anchor" jsonb,
	"decision" jsonb,
	"criterion" integer,
	"ai" boolean DEFAULT false NOT NULL,
	"report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_participant" (
	"thread_id" uuid NOT NULL,
	"person_id" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_participant_thread_id_person_id_pk" PRIMARY KEY("thread_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "review_thread" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid,
	"submission_id" uuid,
	"peer_id" uuid,
	"version" integer NOT NULL,
	"author_id" text NOT NULL,
	"host_id" text NOT NULL,
	"mode" text NOT NULL,
	"topic" text NOT NULL,
	"title" text NOT NULL,
	"course_paragraphs" jsonb,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ended_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_thread_peer_id_unique" UNIQUE("peer_id"),
	CONSTRAINT "review_thread_one_target" CHECK (num_nonnulls("review_thread"."document_id", "review_thread"."submission_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "assignment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "review_thread_id" uuid;--> statement-breakpoint
ALTER TABLE "review_message" ADD CONSTRAINT "review_message_thread_id_review_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."review_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_message" ADD CONSTRAINT "review_message_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_message" ADD CONSTRAINT "review_message_reply_to_review_message_id_fk" FOREIGN KEY ("reply_to") REFERENCES "public"."review_message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_participant" ADD CONSTRAINT "review_participant_thread_id_review_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."review_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_participant" ADD CONSTRAINT "review_participant_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_thread" ADD CONSTRAINT "review_thread_document_id_personal_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."personal_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_thread" ADD CONSTRAINT "review_thread_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_thread" ADD CONSTRAINT "review_thread_peer_id_peer_review_id_fk" FOREIGN KEY ("peer_id") REFERENCES "public"."peer_review"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_thread" ADD CONSTRAINT "review_thread_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_thread" ADD CONSTRAINT "review_thread_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_message_thread_id_created_at_index" ON "review_message" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "review_participant_person_id_index" ON "review_participant" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "review_thread_document_id_index" ON "review_thread" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "review_thread_submission_id_index" ON "review_thread" USING btree ("submission_id");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_review_thread_id_review_thread_id_fk" FOREIGN KEY ("review_thread_id") REFERENCES "public"."review_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_one_target" CHECK (num_nonnulls("notification"."assignment_id", "notification"."review_thread_id") = 1);