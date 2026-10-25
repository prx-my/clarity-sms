import { z } from 'zod';
import { aiAuth, aiError } from '@/lib/ai/http';
import { getStore, newSession, usageEvent } from '@/lib/ai/store';
import { allowlisted } from '@/lib/ai/config';
import { insideCallingHours } from '@/lib/ai/policy';
import { CostEngine, estimate } from '@/lib/ai/cost';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { voiceClient } from '@/lib/ai/providers';
import { readiness } from '@/lib/ai/readiness';
import { publicAppUrl, twilioNumber } from '@/lib/twilio';
export const runtime='nodejs';
const schema=z.object({agentId:z.uuid(),contactId:z.uuid(),consentedCall:z.literal(true)}).strict();
export async function POST(request:Request){const denied=await aiAuth(request);if(denied)return denied;
  try{const body=schema.parse(await request.json()),store=getStore(),settings=await store.settings();
    let agent=(await store.agents()).find(a=>a.id===body.agentId);
    if(settings.experiment.enabled){const count=(await store.sessions()).filter(s=>!s.simulation&&s.experiment===settings.experiment.name).length;agent=(await store.agents()).find(a=>a.id===(count%2===0?settings.experiment.baselineAgentId:settings.experiment.optimizedAgentId));}
    if(!agent?.config.enabled)return Response.json({error:'Select an enabled agent'},{status:400});
    const lead=await store.lead(body.contactId);
    if(!lead||lead.optedOut||!lead.consentAt||!lead.consentEvidence||!allowlisted(lead.phone))return Response.json({error:'Outbound AI calls require an allowlisted contact with recorded consent and no opt-out'},{status:403});
    if(lead.phone===twilioNumber())return Response.json({error:'The destination cannot be the application’s own Twilio number'},{status:400});
    if(!insideCallingHours(agent.config,lead.timezone))return Response.json({error:'Outside configured calling hours in the contact’s timezone'},{status:403});
    const recent=(await store.sessions()).filter(s=>!s.simulation&&Date.parse(s.createdAt)>Date.now()-60000);
    if(recent.length>=3||recent.some(s=>Date.parse(s.createdAt)>Date.now()-10000))return Response.json({error:'AI demo rate limit: wait at least 10 seconds between attempts, at most three per minute'},{status:429});
    if((await new CostEngine(store).evaluateBudget()).blockNewOutbound)return Response.json({error:'New outbound AI calls are paused by workspace budget controls'},{status:429});
    const modelIds=[agent.config.model,...(agent.config.escalationModel?[agent.config.escalationModel]:[])];
    const baselineUsage=[usageEvent('preflight','voice','twilio_outbound','1','second',parsePhoneNumberFromString(lead.phone)?.country||'UNKNOWN'),usageEvent('preflight','relay','conversation_relay','1','second'),...modelIds.flatMap(model=>['llm_input','llm_cached_input','llm_output'].map(category=>usageEvent('preflight',category,category,'1','token',model)))];
    const priced=estimate(baselineUsage,await store.rates());if(!priced.complete)return Response.json({error:`Configure effective rate cards before spending on outbound tests: ${priced.missingRates.join(', ')}`},{status:400});
    const ready=await readiness(true,[agent.config.model,...(agent.config.escalationModel?[agent.config.escalationModel]:[])],agent.config.llmProvider||'openai');
    if(!ready.liveReady)return Response.json({error:'Live calling is not ready. Verify credentials, available models, ConversationRelay onboarding and gateway health.',readiness:ready},{status:503});
    const session=newSession(agent,lead,'outbound');
    if(settings.experiment.enabled){session.experiment=settings.experiment.name;session.cohort=agent.id===settings.experiment.baselineAgentId?'baseline':'optimized';}
    await store.createSession(session);await store.event(session.id,'outbound_authorized',{consentAt:lead.consentAt,contactTimezone:lead.timezone});
    try{const call=await voiceClient().calls.create({to:lead.phone,from:twilioNumber(),url:`${publicAppUrl()}/api/twilio/ai/connect?session=${session.id}`,method:'POST',statusCallback:`${publicAppUrl()}/api/twilio/ai/status?session=${session.id}`,statusCallbackMethod:'POST',statusCallbackEvent:['initiated','ringing','answered','completed'],timeout:25,timeLimit:session.agentSnapshot.maxDurationSeconds+90,record:false});
      if(!await store.bindCall(session.id,call.sid))throw new Error('call_mismatch');
      return Response.json({id:session.id,callSid:call.sid},{status:201});
    }catch(error){
      // A network timeout may occur after Twilio accepted the call. Keep its reservation until reconciliation.
      const code=error&&typeof error==='object'&&'status' in error?Number(error.status):0;
      await store.event(session.id,'call_create_error',{code:code||'unknown_result'});
      if(code>=400&&code<500)await store.patchSession(session.id,{state:'FAILED',connectionStatus:'failed',endedAt:new Date().toISOString()});
      return Response.json({error:code?'Twilio rejected the call; inspect its configuration.':'Call creation result is uncertain. Reconcile this session before trying again.',id:session.id},{status:502});
    }
  }catch(e){return aiError(e);}}
