import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, numeric, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Telemetry } from '../lib/monitoring/model';
const time=(n:string)=>timestamp(n,{withTimezone:true,mode:'string'});
const num=(n:string)=>numeric(n,{precision:30,scale:12});
export const monitoringEvents=pgTable('monitoring_events',{
  id:uuid('id').primaryKey().defaultRandom(),workspaceId:text('workspace_id').notNull().default('workspace'),key:text('key').notNull(),
  event:jsonb('event').$type<Telemetry>().notNull(),category:text('category').notNull(),resourceId:text('resource_id').notNull(),
  occurredAt:time('occurred_at').notNull(),ingestedAt:time('ingested_at').notNull().defaultNow(),processedAt:time('processed_at'),
  attempts:integer('attempts').notNull().default(0),retryAt:time('retry_at').notNull().defaultNow(),error:text('error'),
},t=>[uniqueIndex('monitoring_event_key').on(t.workspaceId,t.key),index('monitoring_event_pending').on(t.processedAt,t.retryAt,t.ingestedAt),index('monitoring_event_resource').on(t.workspaceId,t.resourceId,t.occurredAt)]);
export const monitoringResources=pgTable('monitoring_resources',{
  id:uuid('id').primaryKey().defaultRandom(),workspaceId:text('workspace_id').notNull().default('workspace'),provider:text('provider').notNull(),accountId:text('account_id'),resourceId:text('resource_id').notNull(),category:text('category').notNull(),
  interactionId:text('interaction_id'),parentId:text('parent_id'),callSid:text('call_sid'),messageSid:text('message_sid'),sessionId:text('session_id'),agentId:text('agent_id'),campaignId:text('campaign_id'),contactId:text('contact_id'),
  status:text('status'),rank:integer('rank').notNull().default(0),fromNumber:text('from_number'),toNumber:text('to_number'),direction:text('direction'),
  startedAt:time('started_at').notNull(),updatedAt:time('updated_at').notNull(),answeredAt:time('answered_at'),endedAt:time('ended_at'),durationSeconds:integer('duration_seconds'),segments:integer('segments'),estimatedSegments:integer('estimated_segments'),mediaCount:integer('media_count'),errorCode:text('error_code'),
  data:jsonb('data').$type<Record<string,unknown>>().notNull().default({}),reconciledAt:time('reconciled_at'),nextSyncAt:time('next_sync_at').notNull().defaultNow(),syncAttempts:integer('sync_attempts').notNull().default(0),
},t=>[uniqueIndex('monitoring_resource_key').on(t.workspaceId,t.provider,t.resourceId),index('monitoring_resource_time').on(t.workspaceId,t.category,t.startedAt),index('monitoring_resource_interaction').on(t.workspaceId,t.interactionId),index('monitoring_resource_sync').on(t.provider,t.nextSyncAt),index('monitoring_resource_session').on(t.sessionId)]);
export const providerRateCards=pgTable('provider_rate_cards',{
  id:uuid('id').primaryKey().defaultRandom(),workspaceId:text('workspace_id').notNull().default('workspace'),provider:text('provider').notNull(),service:text('service').notNull(),model:text('model').notNull().default(''),currency:text('currency').notNull(),unit:text('unit').notNull(),amount:num('amount').notNull(),effectiveAt:time('effective_at').notNull(),source:text('source').notNull(),increment:integer('increment').notNull().default(1),bundled:boolean('bundled').notNull().default(false),createdAt:time('created_at').notNull().defaultNow(),
},t=>[uniqueIndex('monitoring_rate_version').on(t.workspaceId,t.provider,t.service,t.model,t.effectiveAt),check('monitoring_rate_nonnegative',sql`${t.amount} >= 0 and ${t.increment} > 0`)]);
export const usageMeasurements=pgTable('usage_measurements',{
  id:uuid('id').primaryKey().defaultRandom(),workspaceId:text('workspace_id').notNull().default('workspace'),key:text('key').notNull(),eventId:uuid('event_id').notNull().references(()=>monitoringEvents.id),provider:text('provider').notNull(),resourceId:text('resource_id').notNull(),interactionId:text('interaction_id'),sessionId:text('session_id'),agentId:text('agent_id'),campaignId:text('campaign_id'),contactId:text('contact_id'),accountId:text('account_id'),phoneNumber:text('phone_number'),service:text('service').notNull(),model:text('model').notNull().default(''),quantity:num('quantity'),unit:text('unit').notNull(),periodStart:time('period_start').notNull(),observedAt:time('observed_at').notNull(),confirmed:boolean('confirmed').notNull().default(false),bundled:boolean('bundled').notNull().default(false),rateCardId:uuid('rate_card_id').references(()=>providerRateCards.id),
},t=>[uniqueIndex('monitoring_usage_key').on(t.workspaceId,t.key),index('monitoring_usage_period').on(t.workspaceId,t.periodStart,t.provider),index('monitoring_usage_resource').on(t.workspaceId,t.resourceId),check('monitoring_quantity_nonnegative',sql`${t.quantity} is null or ${t.quantity} >= 0`)]);
export const costLedgerEntries=pgTable('cost_ledger_entries',{
  id:uuid('id').primaryKey().defaultRandom(),workspaceId:text('workspace_id').notNull().default('workspace'),key:text('key').notNull(),measurementId:uuid('measurement_id').notNull().references(()=>usageMeasurements.id),eventId:uuid('event_id').notNull().references(()=>monitoringEvents.id),kind:text('kind').notNull(),amount:num('amount'),currency:text('currency').notNull(),billingReference:text('billing_reference'),rateSnapshot:jsonb('rate_snapshot').$type<Record<string,unknown>>(),recordedAt:time('recorded_at').notNull().defaultNow(),observedAt:time('observed_at').notNull(),
},t=>[uniqueIndex('monitoring_charge_key').on(t.workspaceId,t.key),index('monitoring_charge_latest').on(t.measurementId,t.kind,t.observedAt),check('monitoring_charge_kind',sql`${t.kind} in ('estimated','reported','reconciled')`)]);
export const billingAdjustments=pgTable('billing_adjustments',{
  id:uuid('id').primaryKey().defaultRandom(),workspaceId:text('workspace_id').notNull().default('workspace'),key:text('key').notNull().unique(),measurementId:uuid('measurement_id').notNull().references(()=>usageMeasurements.id),ledgerEntryId:uuid('ledger_entry_id').notNull().references(()=>costLedgerEntries.id),difference:num('difference').notNull(),currency:text('currency').notNull(),reason:text('reason').notNull(),createdAt:time('created_at').notNull().defaultNow(),
});
export const monitoringExchangeRates=pgTable('monitoring_exchange_rates',{
  id:uuid('id').primaryKey().defaultRandom(),workspaceId:text('workspace_id').notNull().default('workspace'),currency:text('currency').notNull(),inrPerUnit:num('inr_per_unit').notNull(),asOf:time('as_of').notNull(),source:text('source').notNull(),createdAt:time('created_at').notNull().defaultNow(),
},t=>[uniqueIndex('monitoring_fx_version').on(t.workspaceId,t.currency,t.asOf),check('monitoring_fx_positive',sql`${t.inrPerUnit} > 0`)]);
export const billingReconciliationRuns=pgTable('billing_reconciliation_runs',{
  id:uuid('id').primaryKey().defaultRandom(),workspaceId:text('workspace_id').notNull().default('workspace'),kind:text('kind').notNull(),status:text('status').notNull(),startedAt:time('started_at').notNull().defaultNow(),endedAt:time('ended_at'),processed:integer('processed').notNull().default(0),pending:integer('pending').notNull().default(0),errors:integer('errors').notNull().default(0),error:text('error'),
});
export const monitoringCheckpoints=pgTable('monitoring_sync_checkpoints',{
  key:text('key').primaryKey(),value:jsonb('value').$type<Record<string,unknown>>().notNull().default({}),leaseUntil:time('lease_until'),updatedAt:time('updated_at').notNull().defaultNow(),
});
export const monitoringAlertRules=pgTable('monitoring_alert_rules',{
  id:uuid('id').primaryKey().defaultRandom(),workspaceId:text('workspace_id').notNull().default('workspace'),name:text('name').notNull(),metric:text('metric').notNull(),threshold:num('threshold').notNull(),windowMinutes:integer('window_minutes').notNull(),minSamples:integer('min_samples').notNull(),severity:text('severity').notNull(),cooldownMinutes:integer('cooldown_minutes').notNull(),scope:text('scope').notNull(),scopeId:text('scope_id').notNull(),currency:text('currency').notNull(),enabled:boolean('enabled').notNull().default(true),
});
export const monitoringAlertInstances=pgTable('monitoring_alert_instances',{
  id:uuid('id').primaryKey().defaultRandom(),workspaceId:text('workspace_id').notNull().default('workspace'),ruleId:uuid('rule_id').references(()=>monitoringAlertRules.id),key:text('key').notNull().unique(),name:text('name').notNull(),severity:text('severity').notNull(),state:text('state').notNull().default('active'),value:text('value').notNull(),samples:integer('samples').notNull(),detectedAt:time('detected_at').notNull().defaultNow(),lastSeenAt:time('last_seen_at').notNull().defaultNow(),resolvedAt:time('resolved_at'),acknowledgedAt:time('acknowledged_at'),
},t=>[index('monitoring_alert_state').on(t.workspaceId,t.state,t.detectedAt)]);
export const monitoringBudgets=pgTable('monitoring_budgets',{
  id:uuid('id').primaryKey().defaultRandom(),workspaceId:text('workspace_id').notNull().default('workspace'),name:text('name').notNull(),scope:text('scope').notNull(),scopeId:text('scope_id').notNull(),period:text('period').notNull(),currency:text('currency').notNull(),limit:num('limit').notNull(),warningPercent:integer('warning_percent').notNull(),criticalPercent:integer('critical_percent').notNull(),
});
