CREATE TABLE "ai_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_call_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_lead_memory" (
	"contact_id" uuid PRIMARY KEY NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consent_at" timestamp with time zone,
	"consent_evidence" text DEFAULT '' NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"generated_text" text,
	"interrupted" boolean DEFAULT false NOT NULL,
	"delivery" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_lead_qualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"summary" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"attributes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_rate_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"category" text NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"unit" text NOT NULL,
	"usd_per_unit" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"bundled" boolean DEFAULT false NOT NULL,
	"increment" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_call_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"call_sid" text,
	"direction" text NOT NULL,
	"phone" text NOT NULL,
	"state" text DEFAULT 'INITIALIZING' NOT NULL,
	"connection_status" text DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"relay_seconds" integer DEFAULT 0 NOT NULL,
	"outcome" text,
	"summary" text DEFAULT '' NOT NULL,
	"simulation" boolean DEFAULT false NOT NULL,
	"agent_snapshot" jsonb NOT NULL,
	"memory" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cohort" text DEFAULT 'optimized' NOT NULL,
	"experiment" text DEFAULT '' NOT NULL,
	CONSTRAINT "ai_call_sessions_call_sid_unique" UNIQUE("call_sid"),
	CONSTRAINT "ai_sessions_direction" CHECK ("ai_call_sessions"."direction" in ('inbound','outbound')),
	CONSTRAINT "ai_sessions_duration" CHECK ("ai_call_sessions"."duration_seconds" >= 0 and "ai_call_sessions"."relay_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_tool_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"status" text NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_call_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"key" text NOT NULL,
	"category" text NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"quantity" text NOT NULL,
	"unit" text NOT NULL,
	"estimated" boolean DEFAULT true NOT NULL,
	"finalized_usd" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_call_events" ADD CONSTRAINT "ai_call_events_session_id_ai_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_call_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_lead_memory" ADD CONSTRAINT "ai_lead_memory_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_messages" ADD CONSTRAINT "ai_conversation_messages_session_id_ai_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_call_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_lead_qualifications" ADD CONSTRAINT "ai_lead_qualifications_session_id_ai_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_call_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_lead_qualifications" ADD CONSTRAINT "ai_lead_qualifications_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_call_sessions" ADD CONSTRAINT "ai_call_sessions_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_call_sessions" ADD CONSTRAINT "ai_call_sessions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_executions" ADD CONSTRAINT "ai_tool_executions_session_id_ai_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_call_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_call_usage" ADD CONSTRAINT "ai_call_usage_session_id_ai_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."ai_call_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_events_session_created" ON "ai_call_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_messages_session_created" ON "ai_conversation_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_qualification_contact" ON "ai_lead_qualifications" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_rate_version" ON "ai_rate_cards" USING btree ("provider","category","model","effective_at");--> statement-breakpoint
CREATE INDEX "ai_sessions_created" ON "ai_call_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_sessions_agent" ON "ai_call_sessions" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_one_active_real_call" ON "ai_call_sessions" USING btree ((1)) WHERE "ai_call_sessions"."simulation" = false and "ai_call_sessions"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_tools_idempotency" ON "ai_tool_executions" USING btree ("session_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_event" ON "ai_call_usage" USING btree ("session_id","key");