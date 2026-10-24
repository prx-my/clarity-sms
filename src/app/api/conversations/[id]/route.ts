import { eq, asc, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { contacts, conversations, messages, messageEvents } from '@/db/schema';
import { authorized, unauthorized, errorResponse } from '@/lib/api';
import { demoEnabled, demoThread } from '@/lib/demo';
export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await authorized()) return unauthorized();
  try {
    const { id } = await context.params;
    if (demoEnabled()) { const thread=demoThread(id); return thread ? Response.json(thread) : Response.json({ error:'Conversation not found' }, { status:404 }); }
    const [row] = await db().select({ id: conversations.id, unreadCount: conversations.unreadCount, status: conversations.status, contact: { id: contacts.id, phone: contacts.phone, name: contacts.name, optedOut: contacts.optedOut } }).from(conversations).innerJoin(contacts, eq(conversations.contactId, contacts.id)).where(eq(conversations.id,id)).limit(1);
    if (!row) return Response.json({ error: 'Conversation not found' }, { status: 404 });
    const list = await db().select().from(messages).where(eq(messages.conversationId,id)).orderBy(asc(messages.createdAt), asc(messages.id));
    const sids = list.map(m => m.twilioSid).filter((value): value is string => !!value);
    const events = sids.length ? await db().select().from(messageEvents).where(inArray(messageEvents.messageSid,sids)).orderBy(asc(messageEvents.createdAt)) : [];
    return Response.json({ ...row, messages: list, events });
  } catch (error) { return errorResponse(error); }
}
