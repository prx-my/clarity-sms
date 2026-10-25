import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { monitoringAlertRules as rules, monitoringAlertInstances as alerts, monitoringBudgets as budgets, monitoringExchangeRates as fx, providerRateCards as rates } from '@/db/schema';
import { MonitoringStore } from '@/lib/monitoring/store';
import { monitoringAuth, monitoringError, rateLimit, audit, csv } from '@/lib/monitoring/http';
import { parseWindow, overview, listResources, detail, costs, health, settings, aiUsage, insights, reconciliationStatus, query } from '@/lib/monitoring/queries';
import { rateSchema, ruleSchema, budgetSchema } from '@/lib/monitoring/model';
import { reconcile, backfillPage } from '@/lib/monitoring/reconcile';
import { tick, prune } from '@/lib/monitoring/worker';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
type Context={params:Promise<{path:string[]}>};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function prepare(request:Request){const denied=await monitoringAuth(request);if(denied)return denied;if(process.env.DEMO_MODE==='1')return json({error:'Monitoring preview is empty. Connect a migrated database and start the monitoring worker to observe real usage.'},503);const store=new MonitoringStore();if(!await rateLimit(store,request.method!=='GET'))return json({error:'Monitoring request limit reached. Retry in one minute.'},429);return store;}
export async function GET(request:Request,context:Context){
  try{
    const store=await prepare(request);if(store instanceof Response)return store;
    const {path}=await context.params,p=new URL(request.url).searchParams,operation=path[0];
    if(operation==='events')return stream(request,store);
    if(operation==='health')return json(await health(store));
    if(operation==='settings'||operation==='alerts'||operation==='rules')return json(await settings(store));
    if(operation==='reconciliation')return json(await reconciliationStatus(store));
    if(['calls','messages','ai'].includes(operation)&&path[1]){const result=await detail(store,z.string().min(1).max(250).parse(path[1]));return result?json(result):json({error:'Resource not found'},404);}
    const w=parseWindow(p);
    if(operation==='overview')return json(await overview(store,w));
    if(operation==='calls'||operation==='messages')return json(await listResources(store,w,operation==='calls'?'VOICE':'MESSAGING',p));
    if(operation==='ai')return json({...await aiUsage(store,w),...await listResources(store,w,'AI_AGENT',p)});
    if(operation==='costs')return json({...await costs(store,w),insights:await insights(store,w),window:w});
    if(operation==='export'){
      const kind=z.enum(['calls','messages']).parse(p.get('kind')),rows:unknown[][]=[['Time UTC','Resource','Direction','From','To','Status','Duration seconds','Reported segments','Reconciled at']];
      let more=true;for(let page=1;page<=10&&more;page++){const params=new URLSearchParams(p);params.set('limit','100');params.set('page',String(page));const data=await listResources(store,w,kind==='calls'?'VOICE':'MESSAGING',params);more=data.hasMore;for(const r of data.items)rows.push([r.startedAt,r.resourceId,r.direction,r.fromNumber,r.toNumber,r.status,r.durationSeconds,r.segments,r.reconciledAt]);}
      await audit(store,'exported',kind);return new Response(csv(rows),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="monitoring-${kind}.csv"`,'Cache-Control':'no-store','X-Export-Limit':'1000','X-Content-Type-Options':'nosniff'}});
    }
    return json({error:'Unknown monitoring operation'},404);
  }catch(error){return monitoringError(error);}
}
export async function POST(request:Request,context:Context){
  try{
    const store=await prepare(request);if(store instanceof Response)return store;
    const {path}=await context.params,operation=path[0],database=store.database(),body=await request.json().catch(()=>({}));let result:unknown;
    if(operation==='rates'){const config=rateSchema.parse(body);await database.insert(rates).values(config);result={ok:true};}
    else if(operation==='rules'){const config=ruleSchema.parse(body);const [r]=await database.insert(rules).values(config).returning();result=r;}
    else if(operation==='budgets'){const config=budgetSchema.parse(body);result=(await database.insert(budgets).values(config).returning())[0];}
    else if(operation==='exchange-rates'){const config=z.object({currency:z.string().regex(/^[A-Z]{3}$/),inrPerUnit:z.string().regex(/^\d+(\.\d{1,12})?$/).refine(s=>Number(s)>0),asOf:z.iso.datetime(),source:z.url()}).strict().parse(body);result=(await database.insert(fx).values(config).returning())[0];}
    else if(operation==='alerts'&&path[1]){const id=z.uuid().parse(path[1]);result=await database.update(alerts).set({acknowledgedAt:new Date().toISOString()}).where(and(eq(alerts.workspaceId,'workspace'),eq(alerts.id,id))).returning();}
    else if(operation==='reconcile')result=await reconcile(store,undefined,5);
    else if(operation==='process')result=await tick(store,false);
    else if(operation==='backfill'){const config=z.object({kind:z.enum(['calls','messages']),start:z.iso.datetime(),end:z.iso.datetime()}).strict().parse(body);parseWindow(new URLSearchParams({start:config.start,end:config.end}));result=await backfillPage(store,config.kind,config.start,config.end);}
    else if(operation==='retention'){const {days}=z.object({days:z.number().int().min(1).max(3650)}).strict().parse(body);await prune(store,days);result={ok:true};}
    else return json({error:'Unknown monitoring operation'},404);
    await audit(store,operation.replaceAll('-','_'),path[1]||operation);return json(result,201);
  }catch(error){return monitoringError(error);}
}
export async function PATCH(request:Request,context:Context){try{const store=await prepare(request);if(store instanceof Response)return store;const {path}=await context.params;if(path[0]!=='rules')return json({error:'Unknown monitoring operation'},404);const id=z.uuid().parse(path[1]),{enabled}=z.object({enabled:z.boolean()}).strict().parse(await request.json());const changed=await store.database().update(rules).set({enabled}).where(and(eq(rules.workspaceId,'workspace'),eq(rules.id,id))).returning();await audit(store,enabled?'rule_enabled':'rule_disabled',id);return json(changed);}catch(e){return monitoringError(e);}}
function stream(request:Request,store:MonitoringStore){
  const encoder=new TextEncoder();let timer:ReturnType<typeof setTimeout>|undefined,closed=false,revision='',cleanup=()=>{};const began=Date.now();
  const body=new ReadableStream({start(controller){
    cleanup=()=>{closed=true;if(timer)clearTimeout(timer);request.signal.removeEventListener('abort',cleanup);try{controller.close();}catch{}};
    request.signal.addEventListener('abort',cleanup,{once:true});
    const send=async()=>{if(closed)return;try{
      if(Date.now()-began>50000||await monitoringAuth(request)){cleanup();return;}
      const [row]=await query<{revision:string}>(store,sql`select concat((select max(ingested_at) from monitoring_events),(select max(processed_at) from monitoring_events),(select max(last_seen_at) from monitoring_alert_instances),(select updated_at from monitoring_sync_checkpoints where key='monitoring:worker')) revision`);
      if(closed)return;if(row.revision!==revision){revision=row.revision;controller.enqueue(encoder.encode(`event: changed\ndata: ${JSON.stringify({revision})}\n\n`));}else controller.enqueue(encoder.encode(': heartbeat\n\n'));
      timer=setTimeout(()=>void send(),5000);
    }catch{if(!closed)try{controller.enqueue(encoder.encode('event: unavailable\ndata: {}\n\n'));}catch{}cleanup();}};void send();
  },cancel(){cleanup();}});
  return new Response(body,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'}});
}
