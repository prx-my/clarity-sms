import { and, asc, eq, sql } from 'drizzle-orm';
import { aiEvents, aiSessions, aiUsage, aiRateCards, aiSettings, monitoringExchangeRates, providerRateCards } from '@/db/schema';
import { MonitoringStore } from './store';
import { hash, callRanks, voiceEvent } from './model';
import type { Session } from '../ai/types';

const services:Record<string,string>={twilio_inbound:'voice_inbound',twilio_outbound:'voice_outbound',twilio_transfer:'voice_outbound'};
const attrs=(s:Session)=>({sessionId:s.id,callSid:s.callSid,agentId:s.agentId,contactId:s.contactId,interactionId:s.callSid||s.id,accountId:process.env.TWILIO_ACCOUNT_SID||null});
export async function importAi(store:MonitoringStore,limit=100){
  const database=store.database();let count=0;
  // Versioned source rates are copied, never updated. A per-message AI SMS rate
  // cannot be treated as a per-segment Twilio rate, so it is deliberately excluded.
  const sourceRates=await database.select().from(aiRateCards);
  for(const r of sourceRates.filter(r=>r.category!=='sms'))await database.insert(providerRateCards).values({id:r.id,provider:r.provider.toLowerCase(),service:services[r.category]||r.category,model:r.model,currency:'USD',unit:r.unit,amount:r.usdPerUnit,effectiveAt:r.effectiveAt,source:r.source,increment:r.increment,bundled:r.bundled}).onConflictDoNothing();
  const [settings]=await database.select().from(aiSettings).where(eq(aiSettings.id,'workspace'));
  const fx=settings?.config.exchangeRate;if(fx&&Number(fx.usdInr)>0)await database.insert(monitoringExchangeRates).values({currency:'USD',inrPerUnit:fx.usdInr,asOf:fx.asOf,source:fx.source}).onConflictDoNothing();
  const cursor=await store.checkpoint('monitoring:ai:events'),at=String(cursor.at||'1970-01-01T00:00:00.000Z'),id=String(cursor.id||'00000000-0000-0000-0000-000000000000');
  const eventRows=await database.select({event:aiEvents,session:aiSessions}).from(aiEvents).innerJoin(aiSessions,eq(aiEvents.sessionId,aiSessions.id)).where(and(eq(aiSessions.simulation,false),sql`(${aiEvents.createdAt},${aiEvents.id}) > (${at}::timestamptz,${id}::uuid)`)).orderBy(asc(aiEvents.createdAt),asc(aiEvents.id)).limit(limit);
  for(const {event:e,session:s} of eventRows){
    await sessionEvent(store,s,e.createdAt);
    if(e.kind==='twilio_status'&&s.callSid&&String(e.data.status) in callRanks){await store.ingest(voiceEvent({AccountSid:process.env.TWILIO_ACCOUNT_SID||'',CallSid:s.callSid,CallStatus:String(e.data.status),CallDuration:s.endedAt?String(s.durationSeconds):'',From:s.direction==='inbound'?s.phone:process.env.TWILIO_PHONE_NUMBER||'',To:s.direction==='inbound'?process.env.TWILIO_PHONE_NUMBER||'':s.phone,Direction:s.direction,Timestamp:e.createdAt},attrs(s)));}
    const type:Record<string,string>={relay_connected:'ai.session.started',session_ended:'ai.session.ended',turn_completed:'ai.turn.completed',interruption:'ai.response.interrupted',tool_completed:'ai.tool.executed',llm_failure:'llm.request.failed',error:'ai.session.failed',transfer_result:'voice.transfer.completed',relay_action:'ai.relay.ended',websocket_disconnected:'system.websocket.disconnected'};
    const category=e.kind==='websocket_disconnected'?'INFRASTRUCTURE':e.kind==='tool_completed'?'TOOL_EXECUTION':e.kind==='llm_failure'?'LLM':'AI_AGENT';
    await store.ingest({key:`ai:event:${e.id}`,type:type[e.kind]||`ai.event.${e.kind.replace(/[^a-z0-9_]/g,'_')}`,category,provider:e.kind==='llm_failure'?s.agentSnapshot.llmProvider:'application',resourceId:`event:${e.id}`,...attrs(s),occurredAt:e.createdAt,status:typeof e.data.status==='string'?e.data.status:null,errorCode:e.kind==='error'||e.kind==='llm_failure'?String(e.data.code||'unknown'):null,data:e.data});
    await store.saveCheckpoint('monitoring:ai:events',{at:e.createdAt,id:e.id});count++;
  }
  const uCursor=await store.checkpoint('monitoring:ai:usage');
  const usageRows=await database.select({usage:aiUsage,session:aiSessions}).from(aiUsage).innerJoin(aiSessions,eq(aiUsage.sessionId,aiSessions.id)).where(and(eq(aiSessions.simulation,false),sql`(${aiUsage.updatedAt},${aiUsage.id}) > (${String(uCursor.at||'1970-01-01T00:00:00.000Z')}::timestamptz,${String(uCursor.id||'00000000-0000-0000-0000-000000000000')}::uuid)`)).orderBy(asc(aiUsage.updatedAt),asc(aiUsage.id)).limit(limit);
  for(const {usage:u,session:s} of usageRows){
    await sessionEvent(store,s,u.updatedAt);
    // Voice callbacks account for actual call legs. SMS is observed at send/callback.
    // Import only independent AI services so neither can be charged twice.
    if(['twilio_inbound','twilio_outbound'].includes(u.category)&&s.callSid){
      const status=s.connectionStatus in callRanks?s.connectionStatus:'queued';
      const event=voiceEvent({AccountSid:process.env.TWILIO_ACCOUNT_SID||'',CallSid:s.callSid,CallStatus:status,From:s.direction==='inbound'?s.phone:process.env.TWILIO_PHONE_NUMBER||'',To:s.direction==='inbound'?process.env.TWILIO_PHONE_NUMBER||'':s.phone,Direction:s.direction,Timestamp:u.updatedAt},attrs(s));
      await store.ingest({...event,key:`ai:voice:${u.id}:${hash([u.quantity,u.metadata])}`,data:{...event.data,durationSeconds:Number(u.quantity),source:u.metadata.source||'gateway connected elapsed estimate',startedAt:s.startedAt||s.createdAt}});
    }
    if(!['twilio_inbound','twilio_outbound','twilio_transfer','sms'].includes(u.category)){
      const service=u.category,provider=service.startsWith('llm_')?String(u.metadata.provider||s.agentSnapshot.llmProvider||'openai'):service==='conversation_relay'?'twilio':String(u.metadata.provider||'unavailable');
      await store.ingest({key:`ai:usage:${u.id}:${hash([u.quantity,u.metadata,u.finalizedUsd])}`,type:service.startsWith('llm_')?'llm.request.completed':'ai.usage.measured',category:service.startsWith('llm_')?'LLM':service==='stt'?'STT':service==='tts'?'TTS':'BILLING',provider,resourceId:service==='conversation_relay'?`relay:${s.id}`:`usage:${u.sessionId}:${u.key.split(':')[0]}`,...attrs(s),occurredAt:u.updatedAt,status:u.metadata.usageIncomplete===true?'incomplete':'completed',data:{...u.metadata,service,model:u.model,quantity:u.metadata.usageIncomplete===true?null:u.quantity,unit:u.unit,source:u.metadata.source||(service==='conversation_relay'?'gateway connected elapsed estimate':'provider usage response'),bundled:u.metadata.bundled===true||(service==='stt'||service==='tts')&&u.metadata.independentProvider!==true}});
    }
    await store.saveCheckpoint('monitoring:ai:usage',{at:u.updatedAt,id:u.id});count++;
  }
  // Tool timing and outcomes are already recorded by the runtime; tool event
  // imports avoid copying any arguments/results or transcript content.
  return count;
}
async function sessionEvent(store:MonitoringStore,s:Session,at:string){
  await store.ingest({key:`ai:session:${s.id}:${hash([s.state,s.connectionStatus,s.endedAt,s.durationSeconds,s.outcome])}`,type:s.endedAt?'ai.session.ended':'ai.session.updated',category:'AI_AGENT',provider:'application',resourceId:s.id,...attrs(s),occurredAt:at,status:s.endedAt?'completed':'active',data:{model:s.agentSnapshot.model,startedAt:s.startedAt||s.createdAt,endedAt:s.endedAt,durationSeconds:s.durationSeconds,outcome:s.outcome,statusRank:s.endedAt?5:1,direction:s.direction}});
}
