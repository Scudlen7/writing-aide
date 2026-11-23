CREATE TABLE "office_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"version" integer NOT NULL,
	"saved_version" integer,
	"mode" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"pending_save" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "personal_document_version" ADD COLUMN "conflict" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "office_session" ADD CONSTRAINT "office_session_document_id_personal_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."personal_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_session" ADD CONSTRAINT "office_session_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;