import { sql } from 'drizzle-orm';
import { monitoringEvents, monitoringResources } from '@/db/schema';
import { MonitoringStore } from './store';
import { importAi } from './bridge';
import { importMessaging } from './messaging-bridge';
import { evaluateAlerts } from './alerts';
import { reconcile } from './reconcile';
export async function tick(store=new MonitoringStore(),billing=false){
  const token=await store.lease('monitoring:tick',300);if(!token)return {locked:true};
  try{await store.drain(25);const imported=await importAi(store,20)+await importMessaging(store,20),projection=await store.drain(50);await store.repriceMissing(10);if(billing&&process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN)await reconcile(store);await evaluateAlerts(store);await store.saveCheckpoint('monitoring:worker',{at:new Date().toISOString(),imported,...projection});return {imported,...projection};}
  finally {await store.release('monitoring:tick',token);}
}
// Operational event retention preserves usage, rate versions, ledger, and source
// events referenced by financial records. Phone numbers are redacted after expiry.
export async function prune(store:MonitoringStore,days:number){
  if(!Number.isInteger(days)||days<1||days>3650)throw new Error('Invalid retention');const before=new Date(Date.now()-days*86400000).toISOString();
  await store.database().delete(monitoringEvents).where(sql`${monitoringEvents.processedAt} is not null and ${monitoringEvents.occurredAt}<${before}::timestamptz and not exists(select 1 from usage_measurements where event_id=${monitoringEvents.id}) and not exists(select 1 from cost_ledger_entries where event_id=${monitoringEvents.id})`);
  await store.database().update(monitoringResources).set({fromNumber:null,toNumber:null,data:sql`${monitoringResources.data} - 'from' - 'to'`}).where(sql`${monitoringResources.endedAt} < ${before}::timestamptz`);
  await store.database().execute(sql`update monitoring_events set event=jsonb_set(event,'{data}',(event->'data')-'from'-'to') where occurred_at<${before}::timestamptz`);
  await store.database().execute(sql`update usage_measurements set phone_number=null where period_start<${before}::timestamptz`);
  await store.saveCheckpoint('monitoring:retention',{at:new Date().toISOString(),before});
}
