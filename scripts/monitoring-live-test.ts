import dotenv from 'dotenv';dotenv.config({path:'.env.local',quiet:true});dotenv.config({quiet:true});
import { writeFile } from 'node:fs/promises';
import { MonitoringStore } from '../src/lib/monitoring/store';
import { PostgresStore } from '../src/lib/ai/store';
import { normalizePhone } from '../src/lib/phone';
import { tick } from '../src/lib/monitoring/worker';
const guard='.ai-local/monitoring-live-test.json';
async function main(){
  const phone=normalizePhone(process.argv.find(a=>a.startsWith('--to='))?.slice(5)||'');if(!phone)throw new Error('Explicit consented --to=+E164 destination required');
  const origin='http://127.0.0.1:3100',login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:process.env.ADMIN_PASSWORD}),signal:AbortSignal.timeout(15000)});
  const cookie=login.headers.get('set-cookie')?.split(';')[0];if(!login.ok||!cookie)throw new Error('Local operator login unavailable');
  const headers={'Content-Type':'application/json',Cookie:cookie,Origin:origin};
  const store=new PostgresStore(),lead=await store.leadByPhone(phone);if(lead.optedOut)throw new Error('Consented test destination is opted out');
  const agent=(await store.agents()).find(a=>a.config.name==='Schrader — Consented owner test');
  if(!agent)throw new Error('Existing owner test profile required');
  if(!(process.env.AI_DEMO_ALLOWED_NUMBERS||'').split(',').map(s=>s.trim()).includes(phone))throw new Error('Explicit test number is not in the existing outbound allowlist');
  const previousSettings=await store.settings(),previousConfig=agent.config;
  const gatewayUrl=new URL(process.env.AI_WEBSOCKET_PUBLIC_URL!);gatewayUrl.protocol='https:';gatewayUrl.pathname='/health';
  const gateway=await fetch(gatewayUrl,{headers:{'x-ai-health':process.env.AI_GATEWAY_SECRET!,'ngrok-skip-browser-warning':'1'},signal:AbortSignal.timeout(10000)});if(!gateway.ok||(await gateway.json()).ready!==true)throw new Error('Gateway readiness unavailable');
  // Exclusive guard prevents redial/resend after an uncertain provider response.
  await writeFile(guard,JSON.stringify({state:'prepared',phone,createdAt:new Date().toISOString()},null,2),{flag:'wx',mode:0o600});
  await store.saveLead({...lead,consentAt:new Date().toISOString(),consentEvidence:'User explicitly authorized one call and one SMS in the Monitoring implementation chat on 2026-10-25.',timezone:'Asia/Kolkata'});
  let record:Record<string,unknown>={state:'prepared',phone,createdAt:new Date().toISOString()};
  const save=async()=>writeFile(guard,JSON.stringify(record,null,2)+'\n',{mode:0o600});
  try{
    await store.saveSettings({...previousSettings,outboundPaused:false});await store.saveAgent(agent.id,{...agent.config,enabled:true,maxDurationSeconds:90,followupEnabled:false});
    const body='Clarity monitoring test: this is the one SMS you authorized. Reply STOP to opt out.';
    record={...record,smsState:'requesting'};await save();
    // Exercise the existing SMS send route, including its persistence and telemetry.
    const sms=await fetch(origin+'/api/messages',{method:'POST',headers,body:JSON.stringify({to:phone,body}),signal:AbortSignal.timeout(25000)});const sent=await sms.json();
    record={...record,smsState:sms.ok?'created':'failed',messageSid:sent.twilioSid||null,smsHttpStatus:sms.status,smsError:sent.error||null};await save();
    if(!sms.ok)throw new Error('SMS request failed; will not resend');
    record={...record,callState:'requesting'};await save();
    const call=await fetch(origin+'/api/ai/sessions',{method:'POST',headers,body:JSON.stringify({agentId:agent.id,contactId:lead.id,consentedCall:true}),signal:AbortSignal.timeout(30000)});const session=await call.json();
    record={...record,callState:call.ok?'created':'failed',callSid:session.callSid||null,sessionId:session.id||null,callHttpStatus:call.status,callError:session.error||null};await save();
    console.log(JSON.stringify({smsCreated:sms.ok,callCreated:call.ok,sessionId:session.id||null,callSid:session.callSid||null,messageSid:sent.twilioSid||null,callError:session.error||null}));
    if(!call.ok)process.exitCode=1;
  }finally{
    await store.saveSettings({...await store.settings(),outboundPaused:previousSettings.outboundPaused});await store.saveAgent(agent.id,previousConfig);
  }
  await tick(new MonitoringStore(),false);
}
void main().catch(error=>{console.error('Authorized monitoring test stopped; inspect the local guard before any retry',{kind:error?.name,code:error?.code||null,reason:error?.message?.slice(0,200)});process.exitCode=1;});
