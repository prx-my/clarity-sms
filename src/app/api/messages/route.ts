import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { db } from '@/db';
import { contacts, conversations, messages, messageEvents } from '@/db/schema';
import { authorized, unauthorized, errorResponse } from '@/lib/api';
import { normalizePhone } from '@/lib/phone';
import { client, publicAppUrl, twilioNumber } from '@/lib/twilio';
import { errorReason } from '@/lib/errors';
import { demoEnabled, demoSend } from '@/lib/demo';
import { collect } from '@/lib/monitoring/store';
import { messageRecord } from '@/lib/monitoring/providers';
import { segments } from '@/lib/monitoring/model';
export const runtime = 'nodejs';
const schema = z.object({ to: z.string().min(1), body: z.string().trim().min(1).max(1600), name: z.string().trim().max(100).optional() });
export async function POST(request: Request) {
  if (!await authorized()) return unauthorized();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Enter a recipient and message (up to 1600 characters)' }, { status: 400 });
  const to = normalizePhone(parsed.data.to);
  if (!to) return Response.json({ error: 'Enter a valid phone number' }, { status: 400 });
  if (demoEnabled()) { const sent=demoSend(to,parsed.data.body,parsed.data.name); return sent ? Response.json(sent,{status:201}) : Response.json({error:'This contact opted out of messages'},{status:403}); }
  try {
    const database = db();
    const [contact] = await database.insert(contacts).values({ phone: to, name: parsed.data.name || null }).onConflictDoUpdate({ target: contacts.phone, set: parsed.data.name ? { name: parsed.data.name } : { phone: to } }).returning();
    if (contact.optedOut) return Response.json({ error: 'This contact opted out of messages' }, { status: 403 });
    const from = twilioNumber();
    const [conversation] = await database.insert(conversations).values({ contactId: contact.id, twilioNumber: from }).onConflictDoUpdate({ target: [conversations.contactId, conversations.twilioNumber], set: { status: 'open' } }).returning();
    let sent;
    try {
      sent = await client().messages.create({ to, from, body: parsed.data.body, statusCallback: `${publicAppUrl()}/api/twilio/status` });
    } catch (error: unknown) {
      const twilioError = error as { code?: number; message?: string };
      await collect({key:`sms-error:${crypto.randomUUID()}`,type:'messaging.request.failed',category:'SYSTEM_EVENT',provider:'twilio',accountId:process.env.TWILIO_ACCOUNT_SID||null,resourceId:`request:${crypto.randomUUID()}`,contactId:contact.id,occurredAt:new Date().toISOString(),status:'failed',errorCode:twilioError.code?String(twilioError.code):'provider_unavailable',data:{}});
      if (twilioError.code === 21610) await database.update(contacts).set({ optedOut: true }).where(eq(contacts.id, contact.id));
      return Response.json({ error: twilioError.code ? errorReason(String(twilioError.code)) : 'Twilio could not send this message', code: twilioError.code || null }, { status: 502 });
    }
    const predicted = segments(parsed.data.body);
    const telemetry = messageRecord(sent, { contactId: contact.id });
    await collect({ ...telemetry, data: { ...telemetry.data, estimatedSegments: predicted.segments, encoding: predicted.encoding } });
    const [message] = await database.insert(messages).values({ conversationId: conversation.id, twilioSid: sent.sid, direction: 'outbound', body: parsed.data.body, fromNumber: from, toNumber: to, numSegments: Number(sent.numSegments) || 1, status: 'queued' }).onConflictDoUpdate({ target: messages.twilioSid, set: { conversationId: conversation.id } }).returning();
    // A callback may arrive before the create response. Reconcile all persisted events now.
    const events = await database.select().from(messageEvents).where(eq(messageEvents.messageSid, sent.sid)).orderBy(desc(messageEvents.createdAt));
    const highest = events.find(e => e.status === 'delivered') || events.find(e => e.status === 'failed' || e.status === 'undelivered') || events[0];
    if (highest) await database.update(messages).set({ status: highest.status, errorCode: highest.errorCode }).where(eq(messages.id, message.id));
    if (events.some(e => e.errorCode === '21610')) await database.update(contacts).set({ optedOut: true }).where(eq(contacts.id, contact.id));
    await database.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversation.id));
    return Response.json({ id: message.id, twilioSid: sent.sid, status: highest?.status || 'queued', conversationId: conversation.id }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
