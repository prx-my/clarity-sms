import dotenv from 'dotenv';dotenv.config({path:'.env.local',quiet:true});dotenv.config({quiet:true});
import { readFile, writeFile } from 'node:fs/promises';
import { eq, sql } from 'drizzle-orm';
import { client } from '../src/lib/twilio';
import { db } from '../src/db';
import { monitoringEvents, monitoringResources, aiSessions, aiUsage, messages, monitoringCheckpoints, usageMeasurements } from '../src/db/schema';
import { MonitoringStore } from '../src/lib/monitoring/store';
import { detail, costs } from '../src/lib/monitoring/queries';
async function main(){
 const record=JSON.parse(await readFile('.ai-local/monitoring-live-test.json','utf8')) as {callSid:string;messageSid:string;sessionId:string;createdAt:string};
 const database=db(),store=new MonitoringStore();
 const [call,message]=await Promise.all([client().calls(record.callSid).fetch(),client().messages(record.messageSid).fetch()]);
 const [session]=await database.select().from(aiSessions).where(eq(aiSessions.id,record.sessionId));
 const [messageRow]=await database.select().from(messages).where(eq(messages.twilioSid,record.messageSid));
 const usage=await database.select().from(aiUsage).where(eq(aiUsage.sessionId,record.sessionId));
 const resources=await database.select().from(monitoringResources).where(sql`${monitoringResources.resourceId} in (${record.callSid},${record.messageSid},${record.sessionId})`);
 const [counts]=await database.select({events:sql<number>`count(*)::int`}).from(monitoringEvents).where(sql`${monitoringEvents.event}->>'sessionId'=${record.sessionId} or ${monitoringEvents.resourceId} in (${record.callSid},${record.messageSid})`);
 const financial=await costs(store,{start:new Date(Date.parse(record.createdAt)-3600000).toISOString(),end:new Date().toISOString(),timezone:'UTC'},sql`u.interaction_id=${record.callSid}`);
 const report={financial:financial.totals,checkedAt:new Date().toISOString(),call:{status:call.status,durationSeconds:Number(call.duration||0),providerPrice:call.price,currency:call.priceUnit,localStatus:session?.connectionStatus,aiState:session?.state,outcome:session?.outcome,aiUsageRecords:usage.length,inputTokens:usage.filter(u=>u.category==='llm_input'||u.category==='llm_cached_input').reduce((n,u)=>n+Number(u.quantity),0),outputTokens:usage.filter(u=>u.category==='llm_output').reduce((n,u)=>n+Number(u.quantity),0)},message:{status:message.status,errorCode:message.errorCode,segments:message.numSegments,providerPrice:message.price,currency:message.priceUnit,localStatus:messageRow?.status},monitoring:{measurements:(await database.select({service:usageMeasurements.service,provider:usageMeasurements.provider,model:usageMeasurements.model,quantity:usageMeasurements.quantity,rate:usageMeasurements.rateCardId}).from(usageMeasurements).where(eq(usageMeasurements.interactionId,record.callSid))),events:counts.events,checkpoints:(await database.select().from(monitoringCheckpoints).where(sql`${monitoringCheckpoints.key} in ('monitoring:worker','monitoring:projector','monitoring:tick')`)).map(c=>({key:c.key,value:c.value,leaseUntil:c.leaseUntil})),projectionErrors:(await database.select({error:monitoringEvents.error,attempts:monitoringEvents.attempts}).from(monitoringEvents).where(sql`${monitoringEvents.error} is not null`).limit(3)),resources:resources.map(r=>({category:r.category,status:r.status,durationSeconds:r.durationSeconds,segments:r.segments,reconciled:!!r.reconciledAt})),callDetailEvents:(await detail(store,record.callSid))?.timeline.length||0,messageDetailEvents:(await detail(store,record.messageSid))?.timeline.length||0}};
 await writeFile('.ai-local/monitoring-verification.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({checkedAt:report.checkedAt,financial:report.financial,call:report.call,message:report.message,monitoring:{events:report.monitoring.events,resources:report.monitoring.resources,callDetailEvents:report.monitoring.callDetailEvents,messageDetailEvents:report.monitoring.messageDetailEvents,projectionErrors:report.monitoring.projectionErrors}}));
}
void main().catch(error=>{console.error('Monitoring verification unavailable',{kind:error?.name,code:error?.code||null});process.exitCode=1;});
