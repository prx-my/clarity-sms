import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { monitoringResources as resources, billingReconciliationRuns as runs } from '@/db/schema';
import { MonitoringStore } from './store';
import { twilioBilling, type BillingProvider, callRecord, messageRecord, billingClient, phoneNumberCharges } from './providers';
export async function reconcile(store:MonitoringStore,provider:BillingProvider=twilioBilling,limit=20){
  const token=await store.lease('monitoring:reconcile',300);if(!token)return {locked:true};
  const database=store.database(),id=crypto.randomUUID();let processed=0,pending=0,errors=0;
  await database.insert(runs).values({id,kind:'reconciliation',status:'running'});
  try {
    const rows=await database.select().from(resources).where(and(eq(resources.workspaceId,'workspace'),eq(resources.provider,'twilio'),sql`${resources.category} in ('VOICE','MESSAGING')`,lte(resources.nextSyncAt,new Date().toISOString()))).orderBy(asc(resources.nextSyncAt)).limit(limit);
    for(const r of rows){
      try {
        const event=await (r.category==='VOICE'?provider.call(r.resourceId):provider.message(r.resourceId));
        if(event.accountId!==process.env.TWILIO_ACCOUNT_SID)throw new Error('Account mismatch');
        const billed=typeof event.data?.price==='string'&&!!event.data?.currency;
        await store.ingest({...event,key:`${event.key}:sync:${id}`,occurredAt:new Date().toISOString(),sessionId:r.sessionId,agentId:r.agentId,campaignId:r.campaignId,contactId:r.contactId,interactionId:r.interactionId});
        await database.update(resources).set({syncAttempts:r.syncAttempts+1,nextSyncAt:new Date(Date.now()+(billed?86400000:Math.min(21600000,30000*2**Math.min(r.syncAttempts,10)))).toISOString()}).where(eq(resources.id,r.id));
        if(billed)processed++;else pending++;
      }catch(error){errors++;const retry=Number((error as {status?:number}).status)===429?120000:60000;
        await database.update(resources).set({syncAttempts:r.syncAttempts+1,nextSyncAt:new Date(Date.now()+Math.min(21600000,retry*2**Math.min(r.syncAttempts,8))).toISOString()}).where(eq(resources.id,r.id));
        if(Number((error as {status?:number}).status)===429)break;
      }
    }
    if(provider===twilioBilling){const last=await store.checkpoint('monitoring:account-usage');if(Date.now()-Date.parse(String(last.at||'1970-01-01'))>21600000){try{for(const event of await phoneNumberCharges())await store.ingest({...event,key:`${event.key}:sync:${id}`});await store.saveCheckpoint('monitoring:account-usage',{at:new Date().toISOString()});}catch{errors++;}}}
    await store.drain(200);
    // Mark confirmed only after the durable outbox has been projected successfully.
    await database.execute(sql`update monitoring_resources r set reconciled_at=now() where r.workspace_id='workspace' and exists (select 1 from usage_measurements u join cost_ledger_entries c on c.measurement_id=u.id where u.resource_id=r.resource_id and u.workspace_id=r.workspace_id and c.kind='reconciled' and c.amount is not null)`);
    await database.update(runs).set({status:errors?'partial':'succeeded',endedAt:new Date().toISOString(),processed,pending,errors}).where(eq(runs.id,id));
    return {id,processed,pending,errors};
  }catch {await database.update(runs).set({status:'failed',endedAt:new Date().toISOString(),errors:errors+1,error:'Provider synchronization unavailable'}).where(eq(runs.id,id));throw new Error('Reconciliation unavailable');}
  finally{await store.release('monitoring:reconcile',token);}
}

// One bounded provider page per invocation. The public API accepts only date
// windows; continuation URLs are persisted by the worker, never supplied by users.
export async function backfillPage(store:MonitoringStore,kind:'calls'|'messages',start:string,end:string,providerApi?:Pick<ReturnType<typeof billingClient>,'calls'|'messages'>){
  const key=`monitoring:backfill:${kind}:${start}:${end}`,token=await store.lease(`${key}:lease`,300);if(!token)return {locked:true};
  const id=crypto.randomUUID(),database=store.database();let processed=0;
  try {
    const cursor=await store.checkpoint(key);if(cursor.done)return cursor;
    await database.insert(runs).values({id,kind:`backfill:${kind}`,status:'running'});
    const api=providerApi||billingClient(),next=typeof cursor.next==='string'?cursor.next:null;
    // Validate the stored URL as defense in depth before handing it to the SDK.
    if(next){const u=new URL(next);if(u.origin!=='https://api.twilio.com'||!u.pathname.startsWith(`/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/`))throw new Error('Invalid cursor');}
    if(kind==='calls'){
      const page=next?await api.calls.getPage(next):await api.calls.page({startTimeAfter:new Date(start),startTimeBefore:new Date(end),pageSize:50});
      for(const c of page.instances){if(c.accountSid!==process.env.TWILIO_ACCOUNT_SID)throw new Error('Account mismatch');await store.ingest(callRecord(c));}processed=page.instances.length;
      await store.saveCheckpoint(key,{start,end,next:page.nextPageUrl||null,done:!page.nextPageUrl,count:Number(cursor.count||0)+page.instances.length});
    }else{
      const page=next?await api.messages.getPage(next):await api.messages.page({dateSentAfter:new Date(start),dateSentBefore:new Date(end),pageSize:50});
      for(const m of page.instances){if(m.accountSid!==process.env.TWILIO_ACCOUNT_SID)throw new Error('Account mismatch');await store.ingest(messageRecord(m));}processed=page.instances.length;
      await store.saveCheckpoint(key,{start,end,next:page.nextPageUrl||null,done:!page.nextPageUrl,count:Number(cursor.count||0)+page.instances.length});
    }
    await database.update(runs).set({status:'succeeded',endedAt:new Date().toISOString(),processed}).where(eq(runs.id,id));
    return store.checkpoint(key);
  }catch {await database.update(runs).set({status:'failed',endedAt:new Date().toISOString(),errors:1,error:'Backfill page failed; checkpoint preserved'}).where(eq(runs.id,id));throw new Error('Backfill unavailable');}
  finally{await store.release(`${key}:lease`,token);}
}
