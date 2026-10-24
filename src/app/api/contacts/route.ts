import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { contacts, conversations } from '@/db/schema';
import { authorized, unauthorized, errorResponse } from '@/lib/api';
import { normalizePhone } from '@/lib/phone';
import { demoEnabled, demoStore } from '@/lib/demo';
export const runtime = 'nodejs';
export async function GET() {
  if (!await authorized()) return unauthorized();
  if (demoEnabled()) return Response.json({items:demoStore().contacts.map(c=>({...c,lastActivityAt:demoStore().conversations.find(t=>t.contact.id===c.id)?.lastMessageAt||null}))});
  try {
    const rows = await db().select().from(contacts).orderBy(desc(contacts.createdAt));
    const items = await Promise.all(rows.map(async contact => {
      const [latest] = await db().select({ lastActivityAt: conversations.lastMessageAt }).from(conversations).where(eq(conversations.contactId, contact.id)).orderBy(desc(conversations.lastMessageAt)).limit(1);
      return { ...contact, lastActivityAt: latest?.lastActivityAt || null };
    }));
    return Response.json({ items });
  }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  if (!await authorized()) return unauthorized();
  const parsed = z.object({ phone: z.string(), name: z.string().trim().max(100).optional() }).safeParse(await request.json().catch(() => null));
  const phone = parsed.success ? normalizePhone(parsed.data.phone) : null;
  if (!parsed.success || !phone) return Response.json({ error: 'Enter a valid phone number' }, { status: 400 });
  if (demoEnabled()) {const store=demoStore();let contact=store.contacts.find(c=>c.phone===phone);if(contact)contact.name=parsed.data.name||null;else{contact={id:crypto.randomUUID(),phone,name:parsed.data.name||null,optedOut:false,createdAt:new Date().toISOString()};store.contacts.push(contact)}return Response.json(contact,{status:201});}
  try { const [contact] = await db().insert(contacts).values({ phone, name: parsed.data.name || null }).onConflictDoUpdate({ target: contacts.phone, set: { name: parsed.data.name || null } }).returning(); return Response.json(contact, { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
