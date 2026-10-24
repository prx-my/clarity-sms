import { gte, desc } from 'drizzle-orm';
import { db } from '@/db';
import { messages } from '@/db/schema';
import { authorized, unauthorized, errorResponse } from '@/lib/api';
import { errorReason } from '@/lib/twilio';
import { demoAnalytics, demoEnabled } from '@/lib/demo';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  if (!await authorized()) return unauthorized();
  if (demoEnabled()) return Response.json(demoAnalytics());
  try {
    const days = new URL(request.url).searchParams.get('range') === '7d' ? 7 : 30;
    const since = new Date(); since.setHours(0,0,0,0); since.setDate(since.getDate() - days + 1);
    const list = await db().select().from(messages).where(gte(messages.createdAt,since)).orderBy(desc(messages.createdAt));
    const sent = list.filter(m => m.direction === 'outbound');
    const inbound = list.filter(m => m.direction === 'inbound');
    const delivered = sent.filter(m => m.status === 'delivered').length;
    const failed = sent.filter(m => m.status === 'failed' || m.status === 'undelivered').length;
    const series = Array.from({length:days}, (_, i) => { const date = new Date(since); date.setDate(date.getDate()+i); const day = date.toISOString().slice(0,10); return { day, sent: sent.filter(m => m.createdAt.toISOString().slice(0,10) === day).length, received: inbound.filter(m => m.createdAt.toISOString().slice(0,10) === day).length }; });
    const sentThreads = new Set(sent.map(m => m.conversationId));
    const repliedThreads = new Set(inbound.filter(m => sentThreads.has(m.conversationId)).map(m => m.conversationId));
    return Response.json({ sent: sent.length, delivered, failed, replyRate: sentThreads.size ? Math.round(repliedThreads.size / sentThreads.size * 100) : 0, series, failures: sent.filter(m => m.status === 'failed' || m.status === 'undelivered').slice(0,5).map(m => ({ id: m.id, to: m.toNumber, code: m.errorCode, reason: errorReason(m.errorCode), createdAt: m.createdAt })) });
  } catch (error) { return errorResponse(error); }
}
