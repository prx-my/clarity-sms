import { cookieName, validSession } from '../session';
import { originAllowed } from '../ai/http';
import { MonitoringStore } from './store';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
export async function monitoringAuth(request:Request){
  const cookie=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
  if(!await validSession(cookie))return Response.json({error:'Unauthorized'},{status:401});
  if(!['GET','HEAD'].includes(request.method)&&!originAllowed(request))return Response.json({error:'Invalid origin'},{status:403});
  return null;
}
export async function rateLimit(store:MonitoringStore,mutating:boolean){
  const key=`monitoring:limit:${mutating?'write':'read'}:${Math.floor(Date.now()/60000)}`,limit=mutating?20:300;
  const result=await store.database().execute(sql`insert into monitoring_sync_checkpoints(key,value) values (${key},'{"count":1}'::jsonb) on conflict(key) do update set value=jsonb_build_object('count',coalesce((monitoring_sync_checkpoints.value->>'count')::int,0)+1),updated_at=now() returning (value->>'count')::int count`);
  return Number((result.rows[0] as {count:number}).count)<=limit;
}
export function monitoringError(error:unknown){
  if(error instanceof z.ZodError||error instanceof Error&&error.message==='INVALID_FILTER')return Response.json({error:'Invalid monitoring parameters. Use ISO dates, a valid timezone and a range up to 366 days.'},{status:400});
  console.error('Monitoring API unavailable',{kind:error instanceof Error?error.name:'Unknown'});
  return Response.json({error:'Monitoring is unavailable. Check database migrations and the monitoring worker.'},{status:503});
}
export function csvCell(value:unknown){let s=String(value??'');if(/^[\s]*[=+\-@\t\r]/.test(s))s=`'${s}`;return `"${s.replaceAll('"','""')}"`;}
export function csv(rows:unknown[][]){return rows.map(row=>row.map(csvCell).join(',')).join('\r\n');}
export async function audit(store:MonitoringStore,action:string,id:string){await store.ingest({key:`admin:${crypto.randomUUID()}`,type:`system.admin.${action}`,category:'SYSTEM_EVENT',provider:'application',resourceId:id,occurredAt:new Date().toISOString(),status:'succeeded',data:{source:'authenticated admin',code:id}});}
