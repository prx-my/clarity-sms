import dotenv from 'dotenv';dotenv.config({path:'.env.local',quiet:true});dotenv.config({quiet:true});
import { readFile, writeFile } from 'node:fs/promises';
import { PostgresStore } from '../src/lib/ai/store';
async function main(){
  if(!process.argv.includes('--call'))throw new Error('Explicit --call required for a human-authorized test');
  const config=JSON.parse(await readFile('.ai-local/setup-result.json','utf8')) as {agentId:string;contactId:string;phone:string};
  const store=new PostgresStore(),lead=await store.lead(config.contactId),agent=(await store.agents()).find(a=>a.id===config.agentId);
  if(!lead?.consentAt||lead.optedOut||!agent||lead.phone!==config.phone)throw new Error('Consented test contact and profile required');
  // A local one-shot guard complements the durable DB reservation. Never blindly redial.
  await writeFile('.ai-local/live-test.json',JSON.stringify({state:'preparing',phone:config.phone,createdAt:new Date().toISOString()},null,2)+'\n',{flag:'wx',mode:0o600});
  const settings=await store.settings();await store.saveSettings({...settings,outboundPaused:false});await store.saveAgent(agent.id,{...agent.config,enabled:true});
  const origin='http://127.0.0.1:3100';
  const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:process.env.ADMIN_PASSWORD}),signal:AbortSignal.timeout(10000)});
  const cookie=login.headers.get('set-cookie')?.split(';')[0];if(!login.ok||!cookie)throw new Error('Local operator login failed');
  const response=await fetch(origin+'/api/ai/sessions',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({agentId:agent.id,contactId:lead.id,consentedCall:true}),signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  await writeFile('.ai-local/live-test.json',JSON.stringify({state:response.ok?'call_requested':'request_failed',createdAt:new Date().toISOString(),phone:config.phone,sessionId:data.id||null,callSid:data.callSid||null,error:data.error||null,httpStatus:response.status},null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({callRequested:response.ok,sessionId:data.id||null,callSid:data.callSid||null,httpStatus:response.status,error:data.error||null}));
  if(!response.ok){await store.saveSettings({...await store.settings(),outboundPaused:true});process.exitCode=1;}
}
void main().catch(error=>{console.error('Authorized demo did not complete',{type:error?.name,code:error?.code||null});process.exitCode=1;});
