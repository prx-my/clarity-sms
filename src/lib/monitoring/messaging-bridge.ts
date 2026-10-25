import { and, asc, sql } from 'drizzle-orm';
import { messages, messageEvents } from '@/db/schema';
import { MonitoringStore } from './store';
import { messageEvent, segments } from './model';

// Durable operational records also recover initial ingestion failures. Bodies
// are read only to predict encoding/segments, and never copied into telemetry.
export async function importMessaging(store:MonitoringStore,limit=100){
  let count=0;const database=store.database(),cursor=await store.checkpoint('monitoring:sms:created');
  const rows=await database.select().from(messages).where(and(sql`${messages.twilioSid} is not null`,sql`(${messages.createdAt},${messages.id}) > (${String(cursor.at||'1970-01-01')}::timestamptz,${String(cursor.id||'00000000-0000-0000-0000-000000000000')}::uuid)`)).orderBy(asc(messages.createdAt),asc(messages.id)).limit(limit);
  for(const m of rows){
    const prediction=m.body?segments(m.body):null;
    const e=messageEvent({AccountSid:process.env.TWILIO_ACCOUNT_SID||'',MessageSid:m.twilioSid!,MessageStatus:m.status,From:m.fromNumber,To:m.toNumber,NumMedia:String(m.mediaUrls.length),ErrorCode:m.errorCode||''});
    await store.ingest({...e,key:`local:message:${m.id}`,occurredAt:m.createdAt.toISOString(),data:{...e.data,direction:m.direction,estimatedSegments:m.mediaUrls.length?null:prediction?.segments??null,encoding:prediction?.encoding,startedAt:m.createdAt.toISOString(),source:'Stored message; provider segments unavailable'}});
    await store.saveCheckpoint('monitoring:sms:created',{at:m.createdAt.toISOString(),id:m.id});count++;
  }
  const ev=await store.checkpoint('monitoring:sms:events');
  const updates=await database.select().from(messageEvents).where(sql`(${messageEvents.createdAt},${messageEvents.id}) > (${String(ev.at||'1970-01-01')}::timestamptz,${String(ev.id||'00000000-0000-0000-0000-000000000000')}::uuid)`).orderBy(asc(messageEvents.createdAt),asc(messageEvents.id)).limit(limit);
  for(const m of updates){
    const e=messageEvent({AccountSid:process.env.TWILIO_ACCOUNT_SID||'',MessageSid:m.messageSid,MessageStatus:m.status,NumSegments:m.raw?.NumSegments||'',ErrorCode:m.errorCode||''});
    await store.ingest({...e,key:`local:message-status:${m.id}`,occurredAt:m.createdAt.toISOString()});
    await store.saveCheckpoint('monitoring:sms:events',{at:m.createdAt.toISOString(),id:m.id});count++;
  }
  return count;
}
