import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { messages, messageEvents, webhookLogs, conversations, contacts } from '@/db/schema';
import { validateWebhook } from '@/lib/twilio';
export const runtime = 'nodejs';
const rank: Record<string,number> = { queued: 0, accepted: 0, sending: 1, sent: 2, delivered: 4, failed: 3, undelivered: 3 };
export async function POST(request: Request) {
  const params = Object.fromEntries(await request.formData()) as Record<string,string>;
  const valid = validateWebhook(request, params);
  const sid = params.MessageSid || null;
  try { await db().insert(webhookLogs).values({ kind: 'status', messageSid: sid, signatureValid: valid, payload: params }); }
  catch (error) { console.error('Failed to log status webhook', error); }
  if (!valid) return new Response('Invalid signature', { status: 403 });
  try {
    const status = params.MessageStatus || params.SmsStatus;
    if (sid && status) {
      await db().insert(messageEvents).values({ messageSid: sid, status, errorCode: params.ErrorCode || null, raw: params });
      const [existing] = await db().select().from(messages).where(eq(messages.twilioSid,sid)).limit(1);
      if (existing && (rank[status] ?? 0) >= (rank[existing.status] ?? 0)) {
        await db().update(messages).set({ status, errorCode: params.ErrorCode || null }).where(eq(messages.id,existing.id));
      }
      if (existing && params.ErrorCode === '21610') {
        const [conversation] = await db().select({ contactId: conversations.contactId }).from(conversations).where(eq(conversations.id, existing.conversationId)).limit(1);
        if (conversation) await db().update(contacts).set({ optedOut: true }).where(eq(contacts.id, conversation.contactId));
      }
    }
  } catch (error) { console.error('Status webhook error', error); }
  return new Response('<Response/>', { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
}
