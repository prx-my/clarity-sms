import dotenv from 'dotenv';dotenv.config({path:'.env.local',quiet:true});dotenv.config({quiet:true});
import { writeFile } from 'node:fs/promises';
async function main(){
 const origin='http://127.0.0.1:3100';
 const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:process.env.ADMIN_PASSWORD}),signal:AbortSignal.timeout(15000)});
 const cookie=login.headers.get('set-cookie')?.split(';')[0];if(!login.ok||!cookie)throw new Error('Operator login failed');
 const checks=await Promise.all(['overview','calls','messages','ai','costs','health','settings','reconciliation'].map(async path=>{
   const r=await fetch(`${origin}/api/monitoring/${path}`,{headers:{Cookie:cookie},signal:AbortSignal.timeout(55000)});const data=await r.json();return {path,status:r.status,error:data.error||null,...(path==='overview'?{resourceCategories:data.counts?.map((c:{category:string;count:number})=>({category:c.category,count:c.count}))}:{}),...(path==='health'?{database:data.database,worker:data.worker?.state,pending:data.queue?.pending,projectionFailures:data.queue?.failed}:{}),...(Array.isArray(data.items)?{rows:data.items.length}:{})};
 }));
 const page=await fetch(origin+'/monitoring',{headers:{Cookie:cookie},signal:AbortSignal.timeout(20000)}),html=await page.text();
 const unauthorized=await fetch(origin+'/api/monitoring/overview',{signal:AbortSignal.timeout(10000)});
 const report={checkedAt:new Date().toISOString(),page:{status:page.status,hasMonitoringTitle:html.includes('Monitoring'),hasApplicationNavigation:html.includes('Inbox')},unauthenticatedStatus:unauthorized.status,checks};
 await writeFile('.ai-local/monitoring-http-verification.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));if(checks.some(c=>c.status!==200)||page.status!==200||unauthorized.status!==401)process.exitCode=1;
}
void main().catch(error=>{console.error('Monitoring HTTP smoke check failed',{kind:error?.name});process.exitCode=1;});
