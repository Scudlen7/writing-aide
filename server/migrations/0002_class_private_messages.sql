CREATE TABLE "chat_message" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_message_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sender_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "chat_message_sender_id_client_id_unique" UNIQUE("sender_id","client_id"),
	CONSTRAINT "chat_message_distinct_participants" CHECK ("chat_message"."sender_id" <> "chat_message"."recipient_id")
);
--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_message_sender_id_recipient_id_id_index" ON "chat_message" USING btree ("sender_id","recipient_id","id");--> statement-breakpoint
CREATE INDEX "chat_message_recipient_id_sender_id_id_index" ON "chat_message" USING btree ("recipient_id","sender_id","id");