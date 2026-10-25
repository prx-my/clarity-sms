import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq, sql } from 'drizzle-orm';
import type { db } from '../src/db';
import * as schema from '../src/db/schema';
import { MonitoringStore } from '../src/lib/monitoring/store';
import { normalize, voiceEvent, messageEvent, segments, hash, type EventInput } from '../src/lib/monitoring/model';
import { fixed, money, price, selectRate, multiply } from '../src/lib/monitoring/money';
import { overview, costs, detail, listResources, aiUsage, health, parseWindow } from '../src/lib/monitoring/queries';
import { reconcile, backfillPage } from '../src/lib/monitoring/reconcile';
import { evaluateAlerts, thresholdExceeded } from '../src/lib/monitoring/alerts';
import { importAi } from '../src/lib/monitoring/bridge';
import { prune } from '../src/lib/monitoring/worker';
import { monitoringAuth, csv, rateLimit } from '../src/lib/monitoring/http';
import { createSession } from '../src/lib/session';
import { defaultAgent } from '../src/lib/ai/config';
import { PostgresStore, newSession, usageEvent } from '../src/lib/ai/store';
import { GET, POST } from '../src/app/api/monitoring/[...path]/route';
import { POST as voiceCallback } from '../src/app/api/twilio/monitoring/voice/route';
import twilio from 'twilio';
Object.assign(process.env,{NODE_ENV:'test',TWILIO_ACCOUNT_SID:'AC'+'b'.repeat(32),TWILIO_AUTH_TOKEN:'test-token',APP_URL:'https://monitor.example.com',SESSION_SECRET:'test-session-secret-at-least-32-chars'});
const account=process.env.TWILIO_ACCOUNT_SID!,sid='CA'+'a'.repeat(32),child='CA'+'c'.repeat(32),sms='SM'+'d'.repeat(32),at='2026-10-25T10:00:00.000Z';
const window={start:'2026-10-25T00:00:00.000Z',end:'2026-10-26T00:00:00.000Z',timezone:'Asia/Kolkata'};
async function setup(directory?:string){const pg=new PGlite(directory);for(const f of ['0000_luxuriant_thunderbolts','0001_yellow_bromley','0002_yellow_bucky'])await pg.exec(await readFile(`drizzle/${f}.sql`,'utf8'));const database=()=>drizzle(pg,{schema}) as unknown as ReturnType<typeof db>;return {pg,database,store:new MonitoringStore(database)};}
const call=(id=sid,status='completed',duration='61',parent='')=>voiceEvent({AccountSid:account,CallSid:id,ParentCallSid:parent,CallStatus:status,CallDuration:duration,From:'+14155550199',To:'+14155550143',Direction:'outbound-api',Timestamp:at});
async function addRate(store:MonitoringStore,service='voice_outbound',unit='minute',amount='0.01',currency='USD'){
 return (await store.database().insert(schema.providerRateCards).values({provider:'twilio',service,model:'US',currency,unit,amount,increment:60,effectiveAt:'2026-01-01T00:00:00.000Z',source:'https://www.twilio.com/en-us/voice/pricing/us'}).returning())[0];
}
test('normalization has stable provider keys, strips contents/secrets and retains native status',()=>{
 const e=call();assert.equal(e.type,'voice.call.completed');assert.equal(e.status,'completed');assert.equal(e.key,call().key);assert.equal(voiceEvent({...{AccountSid:account,CallSid:sid,CallStatus:'in-progress'}}).type,'voice.call.answered');
 const clean=normalize({...e,data:{body:'private',prompt:'private',token:'secret',from:'+14155550199',durationSeconds:61,model:'model'}});assert.deepEqual(clean.data,{from:'+14155550199',durationSeconds:61,model:'model'});
 assert.throws(()=>voiceEvent({CallSid:'bad',CallStatus:'completed'}));assert.throws(()=>messageEvent({MessageSid:sms,MessageStatus:'fictional'}));
});
test('SMS accounting distinguishes GSM extension septets, Unicode and multipart estimates',()=>{
 assert.equal(segments('a'.repeat(160)).segments,1);assert.equal(segments('a'.repeat(161)).segments,2);assert.equal(segments('^'.repeat(81)).segments,2);
 assert.deepEqual(segments('ह'.repeat(71)),{encoding:'UCS-2',segments:2,estimated:true});assert.equal(segments('😀'.repeat(36)).segments,2);assert.equal(segments('').segments,0);
});
test('fixed point pricing, currency conversion, bundled speech and effective versions stay exact',()=>{
 assert.equal(money(fixed('0.1')+fixed('0.2')),'0.300000000000');assert.equal(multiply('0.25','83.123456'),'20.780864000000');
 const r={id:'1',provider:'twilio',service:'voice_outbound',model:'US',amount:'0.01',unit:'minute',currency:'USD',increment:60,bundled:false,source:'https://example.com',effectiveAt:'2026-01-01T00:00:00.000Z'};
 assert.equal(price('61','second',r),'0.020000000000');assert.equal(price('300','second',r,true),'0.000000000000');assert.equal(price('2','token',r),null);
 assert.equal(selectRate([r,{...r,id:'future',effectiveAt:'2027-01-01T00:00:00.000Z'}],'twilio','voice_outbound','US',at)?.id,'1');assert.equal(selectRate([r],'other','voice_outbound','US',at),null);
 assert.equal(thresholdExceeded('0.2','0.2',9,10),false);assert.equal(thresholdExceeded('0.2','0.2',10,10),true);
});
test('durable ingestion is idempotent, orders statuses and bills each leg once with pinned rate versions',async()=>{
 const {pg,store}=await setup();try{
  const rate=await addRate(store);const results=await Promise.all([store.ingest(call()),store.ingest(call())]);assert.equal(results.filter(Boolean).length,1);
  await store.ingest({...call(sid,'ringing',''),occurredAt:'2026-10-25T09:59:00.000Z'});await store.ingest(call(child,'completed','31',sid));
  assert.equal((await store.drain()).failed,0);await store.drain();
  const rows=await store.database().select().from(schema.monitoringResources);assert.equal(rows.find(r=>r.resourceId===sid)?.status,'completed');
  const cost=await costs(store,window);assert.equal(cost.totals[0].estimated,'0.030000000000');assert.equal((await store.database().select().from(schema.usageMeasurements)).length,2);
  const summary=await overview(store,window);assert.equal(summary.counts.find(c=>c.category==='VOICE')?.interactions,1);assert.equal(summary.counts.find(c=>c.category==='VOICE')?.count,2);
  const record=await detail(store,sid);assert.equal(record?.legs.length,2);assert.equal(record?.timeline.length,3);
  await store.database().insert(schema.providerRateCards).values({...rate,id:crypto.randomUUID(),amount:'5.00',effectiveAt:'2026-10-01T00:00:00.000Z'});
  await store.ingest({...call(),key:'later-duration',occurredAt:'2026-10-25T11:00:00.000Z'});await store.drain();assert.equal((await costs(store,window)).totals[0].estimated,'0.030000000000');
  const listed=await listResources(store,window,'VOICE',new URLSearchParams({limit:'1'}));assert.equal(listed.items.length,1);assert.equal(listed.hasMore,true);
 }finally{await pg.close();}
});
test('reconciliation retries missing prices, preserves original currencies and audits corrections without duplicate totals',async()=>{
 const {pg,store}=await setup();try{
  await addRate(store);await store.ingest(call());await store.drain();let raw:string|null=null;
  const provider={async call(){return {...call(),key:`provider:${raw}`,occurredAt:'2026-10-25T11:00:00.000Z',data:{...call().data,price:raw,currency:'USD'}};},async message(){throw new Error('unused');}};
  const a=await reconcile(store,provider);assert.equal('pending' in a&&a.pending,1);assert.equal((await costs(store,window)).totals[0].reconciled,'0');
  async function ready(){await store.database().update(schema.monitoringResources).set({nextSyncAt:'2020-01-01T00:00:00.000Z'});}
  raw='-0.025';await ready();await reconcile(store,provider);await ready();await reconcile(store,provider);
  let c=(await costs(store,window)).totals[0];assert.equal(c.reconciled,'0.025000000000');assert.equal(c.reported,'0.025000000000');assert.equal((await store.database().select().from(schema.billingAdjustments)).length,1);
  raw='-0.03';await ready();await reconcile(store,provider);c=(await costs(store,window)).totals[0];assert.equal(c.reconciled,'0.030000000000');assert.equal((await store.database().select().from(schema.billingAdjustments)).length,2);
  await store.database().insert(schema.monitoringExchangeRates).values({currency:'USD',inrPerUnit:'83.5',source:'https://example.com/exchange-rate',asOf:at});assert.equal((await costs(store,window)).totals[0].inr,'1.670000000000');
  await store.ingest({...call(child,'completed','10'),key:'EUR',data:{...call(child,'completed','10').data,price:'-0.01',currency:'EUR'}});await store.drain();assert.equal((await costs(store,window)).totals.length,2);
  const failing={async call(){throw {status:429};},async message(){throw {status:503};}};await ready();const failed=await reconcile(store,failing);assert.equal('errors' in failed&&failed.errors,1);
 }finally{await pg.close();}
});
test('message submission and delivery are separate; unknown segments and missing streaming usage remain unknown',async()=>{
 const {pg,store}=await setup();try{
  await addRate(store,'sms_outbound','segment','0.005');const e=messageEvent({AccountSid:account,MessageSid:sms,MessageStatus:'sent',From:'+14155550199',To:'+14155550143',NumSegments:'0'});
  await store.ingest({...e,occurredAt:at,data:{...e.data,direction:'outbound-api'}});await store.drain();let rows=await store.database().select().from(schema.usageMeasurements);assert.equal(rows[0].quantity,null);assert.equal((await costs(store,window)).totals[0].unpriced,1);
  await store.ingest({...messageEvent({AccountSid:account,MessageSid:sms,MessageStatus:'undelivered',NumSegments:'3',ErrorCode:'30003'}),occurredAt:'2026-10-25T11:00:00.000Z'});await store.drain();rows=await store.database().select().from(schema.usageMeasurements);assert.equal(rows[0].quantity,'3.000000000000');assert.equal((await costs(store,window)).totals[0].estimated,'0.015000000000');
  await store.ingest({key:'partial',type:'llm.request.failed',provider:'openai',category:'LLM',resourceId:'request-1',occurredAt:at,status:'incomplete',data:{service:'llm_input',model:'gpt-test',quantity:'0',unit:'token',usageIncomplete:true}});await store.drain();assert.equal((await store.database().select().from(schema.usageMeasurements).where(eq(schema.usageMeasurements.provider,'openai')))[0].quantity,null);
  const summary=await overview(store,window);assert.equal(summary.counts.find(c=>c.category==='MESSAGING')?.delivered,0);assert.equal(summary.tokens.missing,1);assert.equal((await aiUsage(store,window)).models.length,1);
 }finally{await pg.close();}
});
test('AI bridge imports actual usage, tools and sessions incrementally, excludes simulations and redacts content',async()=>{
 const {pg,store,database}=await setup();try{
  const ai=new PostgresStore(database),agent=(await ai.agents())[0],lead=await ai.leadByPhone('+14155550143'),session=newSession(agent,lead,'inbound',false);session.callSid=sid;session.createdAt=at;await ai.createSession(session);
  await ai.event(session.id,'tool_completed',{name:'lookup_lead',status:'failed',durationMs:20,body:'private'});
  await ai.recordUsage(usageEvent(session.id,'req1:llm_input','llm_input','100','token','test-model',{provider:'openai',requestId:'request-1'}));
  await ai.recordUsage(usageEvent(session.id,'relay_duration','conversation_relay','60','second','',{source:'gateway connected elapsed estimate'}));
  await importAi(store);await store.drain();await importAi(store);await store.drain();
  const rows=await store.database().select().from(schema.usageMeasurements);assert.equal(rows.length,2);assert.equal(rows.find(r=>r.service==='llm_input')?.quantity,'100.000000000000');
  const central=await store.database().select().from(schema.monitoringEvents);assert.ok(central.every(e=>!('body' in e.event.data)));assert.equal((await store.database().select().from(schema.monitoringResources)).filter(r=>r.category==='AI_AGENT').length,1);
  await ai.recordUsage(usageEvent(session.id,'relay_duration','conversation_relay','90','second'));await importAi(store);await store.drain();assert.equal((await store.database().select().from(schema.usageMeasurements)).find(r=>r.service==='conversation_relay')?.quantity,'90.000000000000');
 }finally{await pg.close();}
});
test('alerts deduplicate, respect minimum samples, resolve and observe cooldown; budgets only monitor',async()=>{
 const {pg,store}=await setup();try{
  await addRate(store);await store.ingest(call());await store.drain();
  await store.database().insert(schema.monitoringAlertRules).values({name:'Spend',metric:'spend',threshold:'0.01',windowMinutes:60,minSamples:1,severity:'warning',cooldownMinutes:30,scope:'workspace',scopeId:'',currency:'USD'});
  await evaluateAlerts(store,new Date('2026-10-25T10:30:00.000Z'));await evaluateAlerts(store,new Date('2026-10-25T10:31:00.000Z'));let rows=await store.database().select().from(schema.monitoringAlertInstances);assert.equal(rows.length,1);assert.equal(rows[0].state,'active');
  await evaluateAlerts(store,new Date('2026-10-25T12:00:00.000Z'));rows=await store.database().select().from(schema.monitoringAlertInstances);assert.equal(rows[0].state,'resolved');
  await store.database().insert(schema.monitoringBudgets).values({name:'Daily',scope:'workspace',scopeId:'',period:'day',currency:'USD',limit:'0.02',warningPercent:80,criticalPercent:100});
  await evaluateAlerts(store,new Date('2026-10-25T12:01:00.000Z'));assert.equal((await store.database().select().from(schema.monitoringAlertInstances)).find(a=>a.name==='Daily')?.severity,'critical');
  assert.equal((await store.database().select().from(schema.monitoringResources))[0].status,'completed');
 }finally{await pg.close();}
});
test('financial data survives reopen and retention preserves source evidence while removing phone numbers',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'clarity-monitor-'));let pg:PGlite|undefined;
 try{
  const s=await setup(directory);pg=s.pg;await addRate(s.store);await s.store.ingest(call());await s.store.drain();await pg.close();pg=new PGlite(directory);
  const store=new MonitoringStore(()=>drizzle(pg!,{schema}) as unknown as ReturnType<typeof db>);assert.equal((await costs(store,window)).totals[0].estimated,'0.020000000000');
  await prune(store,1);assert.equal((await store.database().select().from(schema.usageMeasurements)).length,1);assert.equal((await store.database().select().from(schema.monitoringEvents)).length,1);
 }finally{if(pg)await pg.close();await rm(directory,{recursive:true,force:true});}
});
test('API authorization, origin checks, signatures, date validation and CSV formula safety',async()=>{
 const context={params:Promise.resolve({path:['overview']})};assert.equal((await GET(new Request('https://monitor.example.com/api/monitoring/overview'),context)).status,401);
 const cookie=await createSession(),auth={cookie:`clarity_session=${cookie}`};assert.equal(await monitoringAuth(new Request('https://monitor.example.com/api/monitoring/overview',{headers:auth})),null);
 assert.equal((await POST(new Request('https://monitor.example.com/api/monitoring/rules',{method:'POST',headers:{...auth,origin:'https://evil.example'}}),{params:Promise.resolve({path:['rules']})})).status,403);
 assert.throws(()=>parseWindow(new URLSearchParams({start:'invalid'})));assert.throws(()=>parseWindow(new URLSearchParams({timezone:'Invalid/Timezone'})));
 assert.match(csv([['=cmd','+14155550143','hello,"world"']]),/"'=cmd","'\+14155550143","hello,""world"""/);
 assert.equal((await voiceCallback(new Request('https://monitor.example.com/api/twilio/monitoring/voice',{method:'POST',body:new URLSearchParams({})}))).status,403);
 const params={AccountSid:'AC'+'c'.repeat(32),CallSid:sid,CallStatus:'completed'},url='https://monitor.example.com/api/twilio/monitoring/voice';const signature=twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN!,url,params);
 assert.equal((await voiceCallback(new Request(url,{method:'POST',headers:{'x-twilio-signature':signature},body:new URLSearchParams(params)}))).status,403);
});
test('SQL health checks and persisted rate limiting operate against the real schema',async()=>{
 const {pg,store}=await setup();try{const h=await health(store);assert.equal(h.database,'reachable');assert.equal(h.worker.state,'never_observed');for(let i=0;i<20;i++)assert.equal(await rateLimit(store,true),true);assert.equal(await rateLimit(store,true),false);}finally{await pg.close();}
});
test('signed voice HTTP callbacks persist genuine fields and duplicate requests create one billable measurement',async t=>{
 const {pg,store}=await setup();try{
  await addRate(store);const original=MonitoringStore.prototype.ingest;
  t.mock.method(MonitoringStore.prototype,'ingest',function(input:EventInput){return original.call(store,input);});
  const url='https://monitor.example.com/api/twilio/monitoring/voice',params={AccountSid:account,CallSid:sid,CallStatus:'completed',CallDuration:'61',From:'+14155550199',To:'+14155550143',Direction:'outbound-api',Timestamp:at};
  const signature=twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN!,url,params),request=()=>new Request(url,{method:'POST',headers:{'x-twilio-signature':signature},body:new URLSearchParams(params)});
  assert.equal((await voiceCallback(request())).status,200);assert.equal((await voiceCallback(request())).status,200);await store.drain();assert.equal((await costs(store,window)).totals[0].estimated,'0.020000000000');
 }finally{t.mock.restoreAll();await pg.close();}
});
test('authenticated API reads and writes use the persisted database, including export and details',async t=>{
 const {pg,store,database}=await setup();try{
  t.mock.method(MonitoringStore.prototype,'database',database);
  const cookie=await createSession(),headers={cookie:`clarity_session=${cookie}`,origin:'https://monitor.example.com','Content-Type':'application/json'},base='https://monitor.example.com/api/monitoring/';
  const create=await POST(new Request(base+'rates',{method:'POST',headers,body:JSON.stringify({provider:'twilio',service:'voice_outbound',model:'US',currency:'USD',unit:'minute',amount:'0.01',effectiveAt:'2026-01-01T00:00:00.000Z',source:'https://www.twilio.com/en-us/voice/pricing/us',increment:60,bundled:false})}),{params:Promise.resolve({path:['rates']})});
  assert.equal(create.status,201);await store.ingest(call());await store.drain();
  for(const path of ['overview','calls',`calls/${sid}`,'messages','ai','costs','health','settings','reconciliation']){
    const response=await GET(new Request(`${base}${path}?start=${window.start}&end=${window.end}`,{headers}),{params:Promise.resolve({path:path.split('/')})});assert.equal(response.status,200,path);
  }
  const exported=await GET(new Request(`${base}export?kind=calls&start=${window.start}&end=${window.end}`,{headers}),{params:Promise.resolve({path:['export']})});assert.equal(exported.status,200);assert.match(await exported.text(),/CAaaaaaaaa/);
 }finally{t.mock.restoreAll();await pg.close();}
});
test('incomplete projection is retried from the durable event store and leases prevent concurrent drains',async()=>{
 const {pg,database,store}=await setup();try{
  class FlakyStore extends MonitoringStore {failed=false;override async project(row:Parameters<MonitoringStore['project']>[0]){if(!this.failed){this.failed=true;throw new Error('Transient storage failure');}await super.project(row);}}
  const flaky=new FlakyStore(database);await store.ingest(call());assert.equal((await flaky.drain()).failed,1);const [pending]=await database().select().from(schema.monitoringEvents);assert.equal(pending.processedAt,null);assert.equal(pending.attempts,1);
  await database().update(schema.monitoringEvents).set({retryAt:'2020-01-01T00:00:00.000Z'});assert.equal((await flaky.drain()).processed,1);
  const token=await store.lease('monitoring:projector');assert.ok(token);assert.equal((await store.drain()).locked,true);await store.release('monitoring:projector',token!);
 }finally{await pg.close();}
});
test('billing credits, unallocated account charges and price reversions are auditable',async()=>{
 const {pg,store}=await setup();try{
  await addRate(store);await store.ingest(call());await store.drain();
  for(const [n,p] of ['-0.02','-0.03','-0.02'].entries()){
    await store.ingest({...call(),key:`price-change-${n}`,occurredAt:`2026-10-25T1${n+1}:00:00.000Z`,data:{...call().data,price:p,currency:'USD'}});await store.drain();
  }
  assert.equal((await costs(store,window)).totals[0].reconciled,'0.020000000000');
  await store.ingest({key:'account-fee',type:'billing.usage.reconciled',category:'BILLING',provider:'twilio',accountId:account,resourceId:'account:phone-fees',occurredAt:at,interactionId:null,data:{service:'phone_numbers',quantity:'1',unit:'number-day',price:'0.05',priceConvention:'expense',currency:'USD'}});await store.drain();
  const total=(await costs(store,window)).totals[0];assert.equal(total.unallocated,'0.050000000000');assert.equal(total.reconciled,'0.070000000000');assert.equal(total.difference,'0.000000000000');
 }finally{await pg.close();}
});
test('SMS source recovery imports content-free initial records and later delivery callbacks',async()=>{
 const {pg,store,database}=await setup();try{
  const { importMessaging }=await import('../src/lib/monitoring/messaging-bridge');
  const [contact]=await database().insert(schema.contacts).values({phone:'+14155550143'}).returning();
  const [thread]=await database().insert(schema.conversations).values({contactId:contact.id,twilioNumber:'+14155550199'}).returning();
  await database().insert(schema.messages).values({twilioSid:sms,conversationId:thread.id,direction:'outbound',fromNumber:'+14155550199',toNumber:'+14155550143',body:'^'.repeat(81),status:'sent',createdAt:new Date(at)});
  await importMessaging(store);await store.drain();let rows=await database().select().from(schema.monitoringResources);assert.equal(rows[0].estimatedSegments,2);assert.equal(rows[0].segments,null);
  await database().insert(schema.messageEvents).values({messageSid:sms,status:'delivered',raw:{NumSegments:'2',Body:'private'},createdAt:new Date('2026-10-25T11:00:00.000Z')});await importMessaging(store);await store.drain();
  rows=await database().select().from(schema.monitoringResources);assert.equal(rows[0].status,'delivered');assert.equal(rows[0].segments,2);
  assert.ok((await database().select().from(schema.monitoringEvents)).every(e=>!('body' in e.event.data)&&!('Body' in e.event.data)));assert.equal(await importMessaging(store),0);
 }finally{await pg.close();}
});
test('confirmed provider duration can correct an estimate without allowing stale records to regress it',async()=>{
 const {pg,store}=await setup();try{
  await addRate(store);await store.ingest({...call(),key:'estimated-duration',data:{...call().data,durationSeconds:120,source:'gateway connected elapsed estimate'}});await store.drain();
  await store.ingest({...call(),key:'provider-duration',occurredAt:'2026-10-25T11:00:00.000Z',data:{...call().data,durationSeconds:60,source:'Twilio Call resource'}});await store.drain();
  assert.equal((await store.database().select().from(schema.monitoringResources))[0].durationSeconds,60);
  await store.ingest({...call(),key:'stale-provider-duration',data:{...call().data,durationSeconds:10,source:'Twilio Call resource'}});await store.drain();
  assert.equal((await store.database().select().from(schema.monitoringResources))[0].durationSeconds,60);assert.equal((await costs(store,window)).totals[0].estimated,'0.010000000000');
 }finally{await pg.close();}
});

test('historical backfill preserves a page checkpoint, deduplicates replay and cannot regress a completed resource',async()=>{
 const {pg,store}=await setup();try{
  const native={accountSid:account,sid,parentCallSid:'',status:'ringing',duration:'',from:'+14155550199',to:'+14155550143',direction:'outbound-api',dateCreated:new Date(at),dateUpdated:new Date(at),endTime:null,price:null,priceUnit:'USD'};
  let pages=0;const next=`https://api.twilio.com/2010-04-01/Accounts/${account}/Calls.json?PageToken=two`;
  const api={calls:{async page(){pages++;return {instances:[native],nextPageUrl:next};},async getPage(url:string){assert.equal(url,next);pages++;return {instances:[native],nextPageUrl:null};}}} as unknown as NonNullable<Parameters<typeof backfillPage>[4]>;
  await store.ingest(call());await store.drain();
  const first=await backfillPage(store,'calls',window.start,window.end,api);assert.equal(first.done,false);assert.equal(first.count,1);
  const second=await backfillPage(store,'calls',window.start,window.end,api);assert.equal(second.done,true);assert.equal(second.count,2);
  await backfillPage(store,'calls',window.start,window.end,api);assert.equal(pages,2);await store.drain();assert.equal((await store.database().select().from(schema.monitoringResources))[0].status,'completed');assert.equal((await store.database().select().from(schema.usageMeasurements)).length,1);
 }finally{await pg.close();}
});
