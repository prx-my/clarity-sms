import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { conversations } from '@/db/schema';
import { authorized, unauthorized, errorResponse } from '@/lib/api';
import { demoEnabled, demoStore } from '@/lib/demo';
export const runtime = 'nodejs';
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await authorized()) return unauthorized();
  try { const { id } = await context.params; if(demoEnabled()){const item=demoStore().conversations.find(c=>c.id===id);if(!item)return Response.json({error:'Not found'},{status:404});item.status=item.status==='archived'?'open':'archived';return Response.json({status:item.status})} const [current] = await db().select().from(conversations).where(eq(conversations.id,id)).limit(1); if (!current) return Response.json({ error: 'Not found' }, { status: 404 }); const status = current.status === 'archived' ? 'open' : 'archived'; await db().update(conversations).set({ status }).where(eq(conversations.id,id)); return Response.json({ status }); }
  catch (error) { return errorResponse(error); }
}
