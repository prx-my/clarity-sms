import { and, asc, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { monitoringEvents as events, monitoringResources as resources, usageMeasurements as usage, providerRateCards as rates, costLedgerEntries as ledger, billingAdjustments as adjustments, monitoringCheckpoints as checkpoints } from '@/db/schema';
import { normalize, hash, type EventInput, type Telemetry } from './model';
import { fixed, money, price, selectRate, twilioExpense } from './money';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
export type Resource=typeof resources.$inferSelect;
export type Measurement=typeof usage.$inferSelect;
export type EventRow=typeof events.$inferSelect;
export const workspace='workspace';
export class MonitoringStore {
  constructor(private readonly databaseFactory:typeof db=db){}
  database(){return this.databaseFactory();}
  async ingest(input:EventInput) {
    const event=normalize(input);if(event.testData&&process.env.NODE_ENV!=='test')throw new Error('Test telemetry is not accepted in application storage');
    return (await this.database().insert(events).values({workspaceId:workspace,key:event.key,event,category:event.category,resourceId:event.resourceId,occurredAt:event.occurredAt}).onConflictDoNothing().returning({id:events.id}))[0]?.id||null;
  }
  async lease(key:string,seconds=120){const token=crypto.randomUUID();const result=await this.database().insert(checkpoints).values({key,value:{token},leaseUntil:new Date(Date.now()+seconds*1000).toISOString()}).onConflictDoUpdate({target:checkpoints.key,set:{value:{token},leaseUntil:new Date(Date.now()+seconds*1000).toISOString(),updatedAt:new Date().toISOString()},setWhere:sql`${checkpoints.leaseUntil} is null or ${checkpoints.leaseUntil} < now()`}).returning();return result.length?token:null;}
  async release(key:string,token:string){await this.database().update(checkpoints).set({leaseUntil:null,updatedAt:new Date().toISOString()}).where(and(eq(checkpoints.key,key),sql`${checkpoints.value}->>'token' = ${token}`));}
  async checkpoint(key:string){return (await this.database().select().from(checkpoints).where(eq(checkpoints.key,key)))[0]?.value||{};}
  async saveCheckpoint(key:string,value:Record<string,unknown>){await this.database().insert(checkpoints).values({key,value}).onConflictDoUpdate({target:checkpoints.key,set:{value,updatedAt:new Date().toISOString()}});}
  async drain(limit=100){
    const token=await this.lease('monitoring:projector',300);if(!token)return {processed:0,failed:0,locked:true};let processed=0,failed=0;
    try {
      const rows=await this.database().select().from(events).where(and(eq(events.workspaceId,workspace),isNull(events.processedAt),lte(events.retryAt,new Date().toISOString()))).orderBy(desc(events.occurredAt),asc(events.ingestedAt),asc(events.id)).limit(limit);
      // Four bounded projection tasks hide HTTP database round-trip latency.
      // Resource ranks and usage observation guards remain atomic in Postgres.
      for(let offset=0;offset<rows.length;offset+=4){
        await Promise.all(rows.slice(offset,offset+4).map(async row=>{try{await this.project(row);await this.database().update(events).set({processedAt:new Date().toISOString(),error:null}).where(eq(events.id,row.id));processed++;}
          catch {failed++;await this.database().update(events).set({attempts:row.attempts+1,error:'Projection failed; retry scheduled',retryAt:new Date(Date.now()+Math.min(3600000,1000*2**Math.min(row.attempts,12))).toISOString()}).where(eq(events.id,row.id));}}));
        const renewed=await this.database().update(checkpoints).set({leaseUntil:new Date(Date.now()+300000).toISOString()}).where(and(eq(checkpoints.key,'monitoring:projector'),sql`${checkpoints.value}->>'token'=${token}`)).returning({key:checkpoints.key});if(!renewed.length)break;
      }
      await this.saveCheckpoint('monitoring:worker',{at:new Date().toISOString(),processed,failed});return {processed,failed,locked:false};
    } finally {await this.release('monitoring:projector',token);}
  }
  async project(row:EventRow){
    const e=row.event,d=e.data;let resource:Resource|null=null;
    if(['VOICE','MESSAGING'].includes(e.category)||e.category==='AI_AGENT'&&e.resourceId===e.sessionId)resource=await this.projectResource(e);
    const spec=measurementSpec(e,resource);if(!spec)return;
    const rateRows=await this.database().select().from(rates).where(eq(rates.workspaceId,workspace));
    const key=`${e.provider}:${e.accountId||''}:${e.resourceId}:${['VOICE','MESSAGING'].includes(e.category)?'resource':spec.service}`;
    const [old]=await this.database().select().from(usage).where(and(eq(usage.workspaceId,workspace),eq(usage.key,key)));
    const at=old?.periodStart||resource?.startedAt||(typeof d.startedAt==='string'?d.startedAt:e.occurredAt);
    // Pin an existing estimate to its original rate version. Later rates never
    // silently reprice historical charges. Previously missing rates can be filled.
    const rate=old?.rateCardId&&old.service===spec.service&&old.model===spec.model?rateRows.find(r=>r.id===old.rateCardId)||null:selectRate(rateRows,e.provider,spec.service,spec.model,at);
    const [measurement]=await this.database().insert(usage).values({id:old?.id||crypto.randomUUID(),workspaceId:workspace,key,eventId:row.id,provider:e.provider,accountId:e.accountId,resourceId:e.resourceId,interactionId:resource?.interactionId||e.interactionId,sessionId:resource?.sessionId||e.sessionId,agentId:resource?.agentId||e.agentId,campaignId:resource?.campaignId||e.campaignId,contactId:resource?.contactId||e.contactId,phoneNumber:resource?(resource.direction?.startsWith('inbound')?resource.toNumber:resource.fromNumber):null,service:spec.service,model:spec.model,quantity:spec.quantity,unit:spec.unit,periodStart:at,observedAt:e.occurredAt,confirmed:spec.confirmed,bundled:d.bundled===true,rateCardId:rate?.id||null})
      .onConflictDoUpdate({target:[usage.workspaceId,usage.key],set:{eventId:row.id,service:spec.service,model:spec.model,phoneNumber:resource?(resource.direction?.startsWith('inbound')?resource.toNumber:resource.fromNumber):old?.phoneNumber,quantity:spec.quantity,observedAt:e.occurredAt,confirmed:spec.confirmed,rateCardId:rate?.id||null,
        interactionId:resource?.interactionId||e.interactionId||old?.interactionId,sessionId:resource?.sessionId||e.sessionId||old?.sessionId,agentId:resource?.agentId||e.agentId||old?.agentId,campaignId:resource?.campaignId||e.campaignId||old?.campaignId,contactId:resource?.contactId||e.contactId||old?.contactId},
        setWhere:sql`${usage.observedAt} <= ${e.occurredAt}::timestamptz and (not ${usage.confirmed} or ${spec.confirmed})`}).returning();
    const current=measurement||old;if(!current)return;
    let estimated:string|null=null;
    if(current.quantity!==null){if(current.bundled)estimated=money(BigInt(0));else if(rate)estimated=price(current.quantity,current.unit,rate);}
    const estimateKey=`estimate:${current.id}:${row.id}:${hash([current.quantity,rate?.id||null,current.bundled])}`;
    const [previousEstimate]=await this.database().select().from(ledger).where(and(eq(ledger.measurementId,current.id),eq(ledger.kind,'estimated'))).orderBy(desc(ledger.observedAt),desc(ledger.recordedAt),desc(ledger.id)).limit(1);
    const estimateCurrency=rate?.currency||(typeof d.currency==='string'?d.currency:'XXX');
    if(!previousEstimate||previousEstimate.amount!==estimated||previousEstimate.currency!==estimateCurrency||previousEstimate.rateSnapshot?.id!==(rate?.id||undefined))await this.database().insert(ledger).values({workspaceId:workspace,key:estimateKey,measurementId:current.id,eventId:row.id,kind:'estimated',amount:estimated,currency:estimateCurrency,observedAt:current.observedAt,rateSnapshot:rate?{...rate}:null}).onConflictDoNothing();
    // A provider price belongs only to its resource service, never bundled speech
    // or the logical AI session. Missing price remains null (not a zero charge).
    if(typeof d.price==='string'&&typeof d.currency==='string'&&/^[A-Z]{3}$/.test(d.currency)){
      const amount=d.priceConvention==='expense'?money(fixed(d.price)):twilioExpense(d.price);
      const [previousReported]=await this.database().select().from(ledger).where(and(eq(ledger.measurementId,current.id),eq(ledger.kind,'reported'))).orderBy(desc(ledger.observedAt),desc(ledger.recordedAt),desc(ledger.id)).limit(1);
      const entryKey=previousReported&&previousReported.amount===amount&&previousReported.currency===d.currency?previousReported.key:`reported:${current.id}:${row.id}:${hash([amount,d.currency])}`;
      const [reported]=await this.database().insert(ledger).values({workspaceId:workspace,key:entryKey,measurementId:current.id,eventId:row.id,kind:'reported',amount,currency:d.currency,billingReference:String(d.billingReference||e.resourceId),observedAt:e.occurredAt}).onConflictDoNothing().returning();
      await this.database().insert(ledger).values({workspaceId:workspace,key:`reconciled:${entryKey}`,measurementId:current.id,eventId:row.id,kind:'reconciled',amount,currency:d.currency,billingReference:String(d.billingReference||e.resourceId),observedAt:e.occurredAt}).onConflictDoNothing();
      const source=reported||(await this.database().select().from(ledger).where(eq(ledger.key,entryKey)))[0];
      if(source&&estimated!==null&&rate?.currency===d.currency)await this.database().insert(adjustments).values({key:`adjustment:${entryKey}`,measurementId:current.id,ledgerEntryId:source.id,difference:money(fixed(amount)-fixed(estimated)),currency:d.currency,reason:'Provider resource price minus versioned estimate'}).onConflictDoNothing();
    }
  }
  async projectResource(e:Telemetry):Promise<Resource>{
    if(e.parentId){const [parent]=await this.database().select().from(resources).where(and(eq(resources.workspaceId,workspace),eq(resources.provider,e.provider),eq(resources.resourceId,e.parentId)));if(parent)e={...e,interactionId:parent.interactionId||parent.resourceId,sessionId:e.sessionId||parent.sessionId,agentId:e.agentId||parent.agentId,contactId:e.contactId||parent.contactId,campaignId:e.campaignId||parent.campaignId};}
    const d=e.data,rank=Number(d.statusRank||0);const maybe=(key:string)=>typeof d[key]==='string'?d[key] as string:null;
    const [r]=await this.database().insert(resources).values({workspaceId:workspace,provider:e.provider,accountId:e.accountId,resourceId:e.resourceId,category:e.category,interactionId:e.interactionId||e.resourceId,parentId:e.parentId,callSid:e.callSid,messageSid:e.messageSid,sessionId:e.sessionId,agentId:e.agentId,campaignId:e.campaignId,contactId:e.contactId,status:e.status,rank,fromNumber:maybe('from'),toNumber:maybe('to'),direction:maybe('direction'),startedAt:maybe('startedAt')||e.occurredAt,updatedAt:e.occurredAt,answeredAt:maybe('answeredAt'),endedAt:maybe('endedAt'),durationSeconds:typeof d.durationSeconds==='number'?Math.floor(d.durationSeconds):null,segments:typeof d.segments==='number'&&d.segments>0?Math.floor(d.segments):null,estimatedSegments:typeof d.estimatedSegments==='number'?d.estimatedSegments:null,mediaCount:typeof d.mediaCount==='number'?d.mediaCount:null,errorCode:e.errorCode,data:d})
      .onConflictDoUpdate({target:[resources.workspaceId,resources.provider,resources.resourceId],set:{
        status:sql`case when ${rank} >= ${resources.rank} then coalesce(${e.status},${resources.status}) else ${resources.status} end`,rank:sql`greatest(${rank},${resources.rank})`,
        fromNumber:sql`coalesce(${maybe('from')},${resources.fromNumber})`,toNumber:sql`coalesce(${maybe('to')},${resources.toNumber})`,direction:sql`coalesce(${maybe('direction')},${resources.direction})`,
        parentId:sql`coalesce(${e.parentId},${resources.parentId})`,interactionId:e.parentId||e.sessionId?e.interactionId||e.parentId||e.sessionId:sql`${resources.interactionId}`,
        sessionId:sql`coalesce(${e.sessionId},${resources.sessionId})`,agentId:sql`coalesce(${e.agentId},${resources.agentId})`,contactId:sql`coalesce(${e.contactId},${resources.contactId})`,campaignId:sql`coalesce(${e.campaignId},${resources.campaignId})`,
        startedAt:sql`least(${resources.startedAt},${maybe('startedAt')||e.occurredAt}::timestamptz)`,updatedAt:sql`greatest(${resources.updatedAt},${e.occurredAt}::timestamptz)`,answeredAt:sql`coalesce(${resources.answeredAt},${maybe('answeredAt')}::timestamptz)`,endedAt:sql`coalesce(${resources.endedAt},${maybe('endedAt')}::timestamptz)`,
        durationSeconds:d.source==='Twilio Call resource'&&typeof d.durationSeconds==='number'?sql`case when ${resources.updatedAt} <= ${e.occurredAt}::timestamptz then ${Math.floor(d.durationSeconds)} else ${resources.durationSeconds} end`:sql`greatest(${resources.durationSeconds},${typeof d.durationSeconds==='number'?Math.floor(d.durationSeconds):null})`,segments:sql`coalesce(${typeof d.segments==='number'&&d.segments>0?Math.floor(d.segments):null},${resources.segments})`,estimatedSegments:sql`coalesce(${typeof d.estimatedSegments==='number'?d.estimatedSegments:null},${resources.estimatedSegments})`,mediaCount:sql`coalesce(${typeof d.mediaCount==='number'?d.mediaCount:null},${resources.mediaCount})`,errorCode:sql`case when ${rank} >= ${resources.rank} then ${e.errorCode} else ${resources.errorCode} end`,
        data:sql`${resources.data} || ${JSON.stringify(Object.fromEntries(Object.entries(d).filter(([,v])=>v!==null)))}::jsonb`,
      }}).returning();return r;
  }
  async repriceMissing(limit=100){
    const missing=await this.database().select({eventId:usage.eventId}).from(usage).where(and(eq(usage.workspaceId,workspace),isNull(usage.rateCardId))).limit(limit);
    for(const m of missing){const [e]=await this.database().select().from(events).where(eq(events.id,m.eventId));if(e)await this.project(e);}
  }
}
function measurementSpec(e:Telemetry,r:Resource|null){
  const d=e.data;
  if(e.category==='VOICE'){
    const nativeDirection=r?.direction||String(d.direction||'');
    const direction=nativeDirection.startsWith('inbound')?'inbound':nativeDirection.startsWith('outbound')?'outbound':'unknown';
    const phone=direction==='inbound'?r?.fromNumber:r?.toNumber;
    const country=phone?parsePhoneNumberFromString(phone)?.country||'UNKNOWN':'UNKNOWN';
    return {service:`voice_${direction}`,model:country,quantity:r?.durationSeconds===null||r?.durationSeconds===undefined?null:String(r.durationSeconds),unit:'second',confirmed:typeof d.durationSeconds==='number'&&d.source!=='gateway connected elapsed estimate'};
  }
  if(e.category==='MESSAGING'){
    const media=(r?.mediaCount||0)>0,dir=r?.direction?.startsWith('inbound')?'inbound':r?.direction?.startsWith('outbound')?'outbound':'unknown',n=r?.segments||r?.estimatedSegments||null;
    return {service:`${media?'mms':'sms'}_${dir}`,model:parsePhoneNumberFromString((dir==='inbound'?r?.fromNumber:r?.toNumber)||'')?.country||'UNKNOWN',quantity:media?'1':n===null?null:String(n),unit:media?'message':'segment',confirmed:media||!!r?.segments};
  }
  if(['LLM','STT','TTS','BILLING'].includes(e.category)&&typeof d.service==='string')return {service:d.service,model:String(d.model||''),quantity:d.usageIncomplete===true||d.quantity===null?null:typeof d.quantity==='string'?d.quantity:null,unit:String(d.unit||'request'),confirmed:d.usageIncomplete!==true&&d.source!=='gateway connected elapsed estimate'};
  return null;
}

export async function collect(input:EventInput){
  if(process.env.DEMO_MODE==='1'||!process.env.DATABASE_URL)return;
  try {
    const persisted=new MonitoringStore().ingest(input);
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {await Promise.race([persisted,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Monitoring timeout')),250);})]);}finally{if(timer)clearTimeout(timer);}
  }catch {console.error('Monitoring ingestion failed; provider recovery may be required',{type:input.type,resourceId:input.resourceId});}
}
