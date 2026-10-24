import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { contacts, conversations, messages, webhookLogs } from '@/db/schema';
import { normalizePhone } from '@/lib/phone';
import { validateWebhook } from '@/lib/twilio';
export const runtime = 'nodejs';
const xml = new Response('<Response/>', { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
export async function POST(request: Request) {
  const params = Object.fromEntries(await request.formData()) as Record<string,string>;
  const valid = validateWebhook(request, params);
  const sid = params.MessageSid || null;
  try { await db().insert(webhookLogs).values({ kind: 'inbound', messageSid: sid, signatureValid: valid, payload: params }); }
  catch (error) { console.error('Failed to log inbound webhook', error); }
  if (!valid) return new Response('Invalid signature', { status: 403 });
  try {
    if (!sid) return xml;
    const from = normalizePhone(params.From || ''), to = normalizePhone(params.To || '');
    if (!from || !to) return xml;
    const [contact] = await db().insert(contacts).values({ phone: from }).onConflictDoUpdate({ target: contacts.phone, set: { phone: from } }).returning();
    const body = params.Body || '';
    if (/^(STOP|UNSUBSCRIBE|CANCEL|END|QUIT)$/i.test(body.trim())) await db().update(contacts).set({ optedOut: true }).where(eq(contacts.id, contact.id));
    const [conversation] = await db().insert(conversations).values({ contactId: contact.id, twilioNumber: to }).onConflictDoUpdate({ target: [conversations.contactId, conversations.twilioNumber], set: { status: 'open' } }).returning();
    const count = Math.min(Number(params.NumMedia) || 0, 10);
    const mediaUrls = Array.from({ length: count }, (_, index) => params[`MediaUrl${index}`]).filter(Boolean);
    const [created] = await db().insert(messages).values({ conversationId: conversation.id, twilioSid: sid, direction: 'inbound', body, fromNumber: from, toNumber: to, mediaUrls, status: 'received' }).onConflictDoNothing({ target: messages.twilioSid }).returning({ id: messages.id });
    if (created) await db().update(conversations).set({ unreadCount: sql`${conversations.unreadCount} + 1`, lastMessageAt: new Date(), status: 'open' }).where(eq(conversations.id, conversation.id));
  } catch (error) { console.error('Inbound webhook error', error); return new Response('Processing failed', { status: 500 }); }
  return xml;
}
