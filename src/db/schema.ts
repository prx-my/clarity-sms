import { pgTable, uuid, text, boolean, timestamp, integer, jsonb, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
