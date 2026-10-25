import { pgTable, uuid, text, boolean, timestamp, integer, jsonb, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { AgentConfig, WorkspaceConfig } from '../lib/ai/config';
import type { State } from '../lib/ai/types';

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(), phone: text('phone').notNull().unique(), name: text('name'),
  optedOut: boolean('opted_out').notNull().default(false), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(), contactId: uuid('contact_id').notNull().references(() => contacts.id),
  twilioNumber: text('twilio_number').notNull(), lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
  unreadCount: integer('unread_count').notNull().default(0), status: text('status').notNull().default('open'),
}, t => [uniqueIndex('conversation_contact_number_unique').on(t.contactId, t.twilioNumber)]);
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(), conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
  twilioSid: text('twilio_sid').unique(), direction: text('direction').notNull(), body: text('body'),
  fromNumber: text('from_number').notNull(), toNumber: text('to_number').notNull(),
  numSegments: integer('num_segments').notNull().default(1), mediaUrls: jsonb('media_urls').$type<string[]>().notNull().default([]),
  status: text('status').notNull().default('queued'), errorCode: text('error_code'), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('messages_conversation_created').on(t.conversationId, t.createdAt), check('messages_direction_check', sql`${t.direction} in ('inbound','outbound')`)]);
export const messageEvents = pgTable('message_events', {
  id: uuid('id').primaryKey().defaultRandom(), messageSid: text('message_sid').notNull(), status: text('status').notNull(),
  errorCode: text('error_code'), raw: jsonb('raw').$type<Record<string,string>>(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('events_sid_created').on(t.messageSid, t.createdAt)]);
export const webhookLogs = pgTable('webhook_logs', {
  id: uuid('id').primaryKey().defaultRandom(), kind: text('kind').notNull(), messageSid: text('message_sid'),
  signatureValid: boolean('signature_valid').notNull(), payload: jsonb('payload').$type<Record<string,string>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// AI tables extend the existing contact identity and leave manual voice/SMS intact.
const aiTimestamp = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
export const aiAgents = pgTable('ai_agents', {
  id: uuid('id').primaryKey().defaultRandom(), config: jsonb('config').$type<AgentConfig>().notNull(),
  updatedAt: aiTimestamp('updated_at').notNull().defaultNow(),
});
export const aiLeadMemory = pgTable('ai_lead_memory', {
  contactId: uuid('contact_id').primaryKey().references(() => contacts.id, { onDelete: 'cascade' }),
  details: jsonb('details').$type<Record<string,string>>().notNull().default({}),
  consentAt: aiTimestamp('consent_at'), consentEvidence: text('consent_evidence').notNull().default(''),
  timezone: text('timezone').notNull().default('America/New_York'),
});
export const aiSettings = pgTable('ai_settings', { id: text('id').primaryKey(), config: jsonb('config').$type<WorkspaceConfig>().notNull() });
export const aiSessions = pgTable('ai_call_sessions', {
  id: uuid('id').primaryKey().defaultRandom(), agentId: uuid('agent_id').notNull().references(() => aiAgents.id),
  contactId: uuid('contact_id').notNull().references(() => contacts.id), callSid: text('call_sid').unique(),
  direction: text('direction').$type<'inbound'|'outbound'>().notNull(), phone: text('phone').notNull(),
  state: text('state').$type<State>().notNull().default('INITIALIZING'), connectionStatus: text('connection_status').notNull().default('queued'),
  startedAt: aiTimestamp('started_at'), endedAt: aiTimestamp('ended_at'), createdAt: aiTimestamp('created_at').notNull().defaultNow(),
  durationSeconds: integer('duration_seconds').notNull().default(0), relaySeconds: integer('relay_seconds').notNull().default(0),
  outcome: text('outcome'), summary: text('summary').notNull().default(''), simulation: boolean('simulation').notNull().default(false),
  agentSnapshot: jsonb('agent_snapshot').$type<AgentConfig>().notNull(), memory: jsonb('memory').$type<Record<string,unknown>>().notNull().default({}),
  cohort: text('cohort').notNull().default('optimized'), experiment: text('experiment').notNull().default(''),
}, t => [index('ai_sessions_created').on(t.createdAt), index('ai_sessions_agent').on(t.agentId),
  check('ai_sessions_direction', sql`${t.direction} in ('inbound','outbound')`),
  check('ai_sessions_duration', sql`${t.durationSeconds} >= 0 and ${t.relaySeconds} >= 0`),
  // A durable reservation also prevents concurrent request/retry abuse in this demo.
  uniqueIndex('ai_one_active_real_call').on(sql`(1)`).where(sql`${t.simulation} = false and ${t.endedAt} is null`),
]);
export const aiMessages = pgTable('ai_conversation_messages', {
  id: uuid('id').primaryKey().defaultRandom(), sessionId: uuid('session_id').notNull().references(() => aiSessions.id, { onDelete: 'cascade' }),
  role: text('role').$type<'user'|'assistant'>().notNull(), text: text('text').notNull(), generatedText: text('generated_text'),
  interrupted: boolean('interrupted').notNull().default(false), delivery: text('delivery').$type<'received'|'submitted'|'interrupted'>().notNull(),
  createdAt: aiTimestamp('created_at').notNull().defaultNow(),
}, t => [index('ai_messages_session_created').on(t.sessionId, t.createdAt)]);
export const aiEvents = pgTable('ai_call_events', {
  id: uuid('id').primaryKey().defaultRandom(), sessionId: uuid('session_id').notNull().references(() => aiSessions.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), data: jsonb('data').$type<Record<string,unknown>>().notNull(), createdAt: aiTimestamp('created_at').notNull().defaultNow(),
}, t => [index('ai_events_session_created').on(t.sessionId, t.createdAt)]);
export const aiTools = pgTable('ai_tool_executions', {
  id: uuid('id').primaryKey().defaultRandom(), sessionId: uuid('session_id').notNull().references(() => aiSessions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), key: text('key').notNull(), input: jsonb('input').$type<Record<string,unknown>>().notNull(),
  output: jsonb('output').$type<Record<string,unknown>|null>(), status: text('status').$type<'pending'|'succeeded'|'failed'|'unknown'>().notNull(),
  durationMs: integer('duration_ms').notNull().default(0), createdAt: aiTimestamp('created_at').notNull().defaultNow(),
}, t => [uniqueIndex('ai_tools_idempotency').on(t.sessionId, t.key)]);
export const aiUsage = pgTable('ai_call_usage', {
  updatedAt: aiTimestamp('updated_at').notNull().defaultNow(),
  id: uuid('id').primaryKey().defaultRandom(), sessionId: uuid('session_id').notNull().references(() => aiSessions.id, { onDelete: 'cascade' }),
  key: text('key').notNull(), category: text('category').notNull(), model: text('model').notNull().default(''),
  quantity: text('quantity').notNull(), unit: text('unit').notNull(), estimated: boolean('estimated').notNull().default(true),
  finalizedUsd: text('finalized_usd'), metadata: jsonb('metadata').$type<Record<string,unknown>>().notNull().default({}),
  createdAt: aiTimestamp('created_at').notNull().defaultNow(),
}, t => [uniqueIndex('ai_usage_event').on(t.sessionId, t.key)]);
export const aiQualifications = pgTable('ai_lead_qualifications', {
  id: uuid('id').primaryKey().defaultRandom(), sessionId: uuid('session_id').notNull().references(() => aiSessions.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').notNull().references(() => contacts.id), outcome: text('outcome').notNull(), summary: text('summary').notNull(),
  evidence: jsonb('evidence').$type<string[]>().notNull(), attributes: jsonb('attributes').$type<Record<string,string>>().notNull(),
  createdAt: aiTimestamp('created_at').notNull().defaultNow(),
}, t => [index('ai_qualification_contact').on(t.contactId)]);
export const aiRateCards = pgTable('ai_rate_cards', {
  id: uuid('id').primaryKey().defaultRandom(), provider: text('provider').notNull(), category: text('category').notNull(),
  model: text('model').notNull().default(''), unit: text('unit').notNull(), usdPerUnit: text('usd_per_unit').notNull(),
  effectiveAt: aiTimestamp('effective_at').notNull(), source: text('source').notNull(), bundled: boolean('bundled').notNull().default(false),
  increment: integer('increment').notNull().default(1),
}, t => [uniqueIndex('ai_rate_version').on(t.provider, t.category, t.model, t.effectiveAt)]);

// Monitoring is an independent read model and accounting ledger. Operational IDs
// are references, not cascading foreign keys: retention must preserve financials.
export * from './monitoring-schema';
