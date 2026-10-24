import { and, desc, eq, ilike, lt, or } from 'drizzle-orm';
import { db } from '@/db';
import { contacts, conversations, messages } from '@/db/schema';
import { authorized, unauthorized, errorResponse } from '@/lib/api';
import { demoConversations, demoEnabled } from '@/lib/demo';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  if (!await authorized()) return unauthorized();
  try {
    const url = new URL(request.url), q = url.searchParams.get('q')?.trim() || '';
    if (demoEnabled()) return Response.json(demoConversations(q));
    const cursor = url.searchParams.get('cursor');
    let cursorDate: Date | undefined, cursorId: string | undefined;
    if (cursor) {
      try {
        const [date, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [string,string];
        const value = new Date(date);
        if (Number.isNaN(value.getTime()) || !/^[a-f0-9-]{36}$/i.test(id)) return Response.json({ error: 'Invalid cursor' }, { status: 400 });
        cursorDate = value; cursorId = id;
      } catch { return Response.json({ error: 'Invalid cursor' }, { status: 400 }); }
    }
    const conditions = [eq(conversations.status, 'open')];
    if (q) conditions.push(or(ilike(contacts.name, `%${q}%`), ilike(contacts.phone, `%${q}%`))!);
    if (cursorDate && cursorId) conditions.push(or(lt(conversations.lastMessageAt, cursorDate), and(eq(conversations.lastMessageAt, cursorDate), lt(conversations.id, cursorId)))!);
    const rows = await db().select({ id: conversations.id, lastMessageAt: conversations.lastMessageAt, unreadCount: conversations.unreadCount, status: conversations.status, contact: { id: contacts.id, phone: contacts.phone, name: contacts.name, optedOut: contacts.optedOut } }).from(conversations).innerJoin(contacts, eq(conversations.contactId, contacts.id)).where(and(...conditions)).orderBy(desc(conversations.lastMessageAt), desc(conversations.id)).limit(31);
    const page = rows.slice(0,30);
    const items = await Promise.all(page.map(async row => {
      const [last] = await db().select({ body: messages.body, direction: messages.direction, status: messages.status, createdAt: messages.createdAt, mediaUrls: messages.mediaUrls }).from(messages).where(eq(messages.conversationId,row.id)).orderBy(desc(messages.createdAt)).limit(1);
      return { ...row, preview: last?.body || (last?.mediaUrls.length ? 'Attachment' : 'No messages yet') };
    }));
    const last = page.at(-1);
    return Response.json({ items, nextCursor: rows.length > 30 && last ? Buffer.from(JSON.stringify([last.lastMessageAt.toISOString(),last.id])).toString('base64url') : null });
  } catch (error) { return errorResponse(error); }
}
