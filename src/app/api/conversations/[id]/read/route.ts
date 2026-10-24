import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { conversations } from '@/db/schema';
import { authorized, unauthorized, errorResponse } from '@/lib/api';
import { demoEnabled, demoStore } from '@/lib/demo';
export const runtime = 'nodejs';
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await authorized()) return unauthorized();
  try { const { id } = await context.params; if(demoEnabled()){const item=demoStore().conversations.find(c=>c.id===id);if(item)item.unreadCount=0;return Response.json({ok:true})} await db().update(conversations).set({ unreadCount: 0 }).where(eq(conversations.id,id)); return Response.json({ ok: true }); }
  catch (error) { return errorResponse(error); }
}
