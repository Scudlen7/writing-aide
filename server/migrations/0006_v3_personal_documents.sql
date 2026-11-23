CREATE TABLE "personal_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trashed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "personal_document_file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"bytes" integer NOT NULL,
	"digest" text NOT NULL,
	"format" text NOT NULL,
	"index_status" text DEFAULT 'pending' NOT NULL,
	"index_text" text,
	"search_text" text,
	"index_error" text,
	"index_lease" timestamp with time zone,
	CONSTRAINT "personal_document_file_document_id_digest_format_unique" UNIQUE("document_id","digest","format")
);
--> statement-breakpoint
CREATE TABLE "personal_document_version" (
	"document_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"source_version" integer,
	"file_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"author_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_document_version_document_id_number_pk" PRIMARY KEY("document_id","number")
);
--> statement-breakpoint
CREATE TABLE "personal_file_cleanup" (
	"id" uuid PRIMARY KEY NOT NULL,
	"after" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personal_document" ADD CONSTRAINT "personal_document_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_document_file" ADD CONSTRAINT "personal_document_file_document_id_personal_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."personal_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_document_version" ADD CONSTRAINT "personal_document_version_document_id_personal_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."personal_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_document_version" ADD CONSTRAINT "personal_document_version_file_id_personal_document_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."personal_document_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_document_version" ADD CONSTRAINT "personal_document_version_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "personal_document_owner_id_updated_at_index" ON "personal_document" USING btree ("owner_id","updated_at");