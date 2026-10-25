import { getStore, usageEvent } from '@/lib/ai/store';
import { xml, fallbackTwiml, validateAiWebhook, applyStatus, relayEndReason } from '@/lib/ai/telephony';
import { uuid } from '@/lib/ai/http';
import { publicAppUrl } from '@/lib/twilio';
export const runtime='nodejs';
export async function POST(request:Request){const p=Object.fromEntries(await request.formData()) as Record<string,string>;if(!validateAiWebhook(request,p))return new Response('Invalid signature',{status:403});
  try{const id=uuid.parse(new URL(request.url).searchParams.get('session')),store=getStore(),s=await store.session(id);if(!s||s.callSid!==p.CallSid)return new Response('Call mismatch',{status:403});
    const reason=relayEndReason(p);
    await store.event(id,'relay_action',{reason,sessionStatus:p.SessionStatus||null,errorCode:p.ErrorCode||null});
    const duration=Number(p.SessionDuration);if(Number.isFinite(duration)&&duration>=0)await store.recordUsage(usageEvent(id,'relay_duration','conversation_relay',String(Math.ceil(duration)),'second','',{source:'Twilio SessionDuration'}));
    if(s.state==='HUMAN_HANDOFF'){const r=new twilio.twiml.VoiceResponse();r.redirect({method:'POST'},`${publicAppUrl()}/api/twilio/ai/transfer?session=${id}`);return xml(r.toString());}
    if(s.direction==='inbound'&&p.CallStatus)await applyStatus(store,id,p);
    if(!s.endedAt)await store.patchSession(id,{endedAt:new Date().toISOString(),state:reason==='opt_out'?'OPTED_OUT':reason==='service_unavailable'?'FAILED':'COMPLETED'});
    return xml(fallbackTwiml(reason));
  }catch{return xml(fallbackTwiml());}}
import twilio from 'twilio';
