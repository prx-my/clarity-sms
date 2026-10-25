CREATE TABLE "billing_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text DEFAULT 'workspace' NOT NULL,
	"key" text NOT NULL,
	"measurement_id" uuid NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"difference" numeric(30, 12) NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_adjustments_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "billing_reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text DEFAULT 'workspace' NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"processed" integer DEFAULT 0 NOT NULL,
	"pending" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "cost_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text DEFAULT 'workspace' NOT NULL,
	"key" text NOT NULL,
	"measurement_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(30, 12),
	"currency" text NOT NULL,
	"billing_reference" text,
	"rate_snapshot" jsonb,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "monitoring_charge_kind" CHECK ("cost_ledger_entries"."kind" in ('estimated','reported','reconciled'))
);
--> statement-breakpoint
CREATE TABLE "monitoring_alert_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text DEFAULT 'workspace' NOT NULL,
	"rule_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"severity" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"value" text NOT NULL,
	"samples" integer NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "monitoring_alert_instances_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "monitoring_alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text DEFAULT 'workspace' NOT NULL,
	"name" text NOT NULL,
	"metric" text NOT NULL,
	"threshold" numeric(30, 12) NOT NULL,
	"window_minutes" integer NOT NULL,
	"min_samples" integer NOT NULL,
	"severity" text NOT NULL,
	"cooldown_minutes" integer NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	"currency" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text DEFAULT 'workspace' NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	"period" text NOT NULL,
	"currency" text NOT NULL,
	"limit" numeric(30, 12) NOT NULL,
	"warning_percent" integer NOT NULL,
	"critical_percent" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_sync_checkpoints" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lease_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text DEFAULT 'workspace' NOT NULL,
	"key" text NOT NULL,
	"event" jsonb NOT NULL,
	"category" text NOT NULL,
	"resource_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "monitoring_exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text DEFAULT 'workspace' NOT NULL,
	"currency" text NOT NULL,
	"inr_per_unit" numeric(30, 12) NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_fx_positive" CHECK ("monitoring_exchange_rates"."inr_per_unit" > 0)
);
--> statement-breakpoint
CREATE TABLE "monitoring_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text DEFAULT 'workspace' NOT NULL,
	"provider" text NOT NULL,
	"account_id" text,
	"resource_id" text NOT NULL,
	"category" text NOT NULL,
	"interaction_id" text,
	"parent_id" text,
	"call_sid" text,
	"message_sid" text,
	"session_id" text,
	"agent_id" text,
	"campaign_id" text,
	"contact_id" text,
	"status" text,
	"rank" integer DEFAULT 0 NOT NULL,
	"from_number" text,
	"to_number" text,
	"direction" text,
	"started_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"segments" integer,
	"estimated_segments" integer,
	"media_count" integer,
	"error_code" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reconciled_at" timestamp with time zone,
	"next_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_rate_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text DEFAULT 'workspace' NOT NULL,
	"provider" text NOT NULL,
	"service" text NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"currency" text NOT NULL,
	"unit" text NOT NULL,
	"amount" numeric(30, 12) NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"increment" integer DEFAULT 1 NOT NULL,
	"bundled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_rate_nonnegative" CHECK ("provider_rate_cards"."amount" >= 0 and "provider_rate_cards"."increment" > 0)
);
--> statement-breakpoint
CREATE TABLE "usage_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text DEFAULT 'workspace' NOT NULL,
	"key" text NOT NULL,
	"event_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"resource_id" text NOT NULL,
	"interaction_id" text,
	"session_id" text,
	"agent_id" text,
	"campaign_id" text,
	"contact_id" text,
	"account_id" text,
	"phone_number" text,
	"service" text NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"quantity" numeric(30, 12),
	"unit" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"bundled" boolean DEFAULT false NOT NULL,
	"rate_card_id" uuid,
	CONSTRAINT "monitoring_quantity_nonnegative" CHECK ("usage_measurements"."quantity" is null or "usage_measurements"."quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_call_usage" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_measurement_id_usage_measurements_id_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."usage_measurements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_ledger_entry_id_cost_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."cost_ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger_entries" ADD CONSTRAINT "cost_ledger_entries_measurement_id_usage_measurements_id_fk" FOREIGN KEY ("measurement_id") REFERENCES "public"."usage_measurements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger_entries" ADD CONSTRAINT "cost_ledger_entries_event_id_monitoring_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."monitoring_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_alert_instances" ADD CONSTRAINT "monitoring_alert_instances_rule_id_monitoring_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."monitoring_alert_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_measurements" ADD CONSTRAINT "usage_measurements_event_id_monitoring_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."monitoring_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_measurements" ADD CONSTRAINT "usage_measurements_rate_card_id_provider_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."provider_rate_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_charge_key" ON "cost_ledger_entries" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "monitoring_charge_latest" ON "cost_ledger_entries" USING btree ("measurement_id","kind","observed_at");--> statement-breakpoint
CREATE INDEX "monitoring_alert_state" ON "monitoring_alert_instances" USING btree ("workspace_id","state","detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_event_key" ON "monitoring_events" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "monitoring_event_pending" ON "monitoring_events" USING btree ("processed_at","retry_at","ingested_at");--> statement-breakpoint
CREATE INDEX "monitoring_event_resource" ON "monitoring_events" USING btree ("workspace_id","resource_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_fx_version" ON "monitoring_exchange_rates" USING btree ("workspace_id","currency","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_resource_key" ON "monitoring_resources" USING btree ("workspace_id","provider","resource_id");--> statement-breakpoint
CREATE INDEX "monitoring_resource_time" ON "monitoring_resources" USING btree ("workspace_id","category","started_at");--> statement-breakpoint
CREATE INDEX "monitoring_resource_interaction" ON "monitoring_resources" USING btree ("workspace_id","interaction_id");--> statement-breakpoint
CREATE INDEX "monitoring_resource_sync" ON "monitoring_resources" USING btree ("provider","next_sync_at");--> statement-breakpoint
CREATE INDEX "monitoring_resource_session" ON "monitoring_resources" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_rate_version" ON "provider_rate_cards" USING btree ("workspace_id","provider","service","model","effective_at");--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_usage_key" ON "usage_measurements" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "monitoring_usage_period" ON "usage_measurements" USING btree ("workspace_id","period_start","provider");--> statement-breakpoint
CREATE INDEX "monitoring_usage_resource" ON "usage_measurements" USING btree ("workspace_id","resource_id");