import twilio from 'twilio';
import { getStore, newSession } from '@/lib/ai/store';
import { aiEnabled, allowlisted } from '@/lib/ai/config';
import { xml, relayTwiml, fallbackTwiml, validateAiWebhook } from '@/lib/ai/telephony';
import { normalizePhone } from '@/lib/phone';
import { voiceClient } from '@/lib/ai/providers';
import { publicAppUrl } from '@/lib/twilio';
export const runtime='nodejs';
export async function POST(request:Request){const p=Object.fromEntries(await request.formData()) as Record<string,string>;if(!validateAiWebhook(request,p))return new Response('Invalid signature',{status:403});
  try{const store=getStore(),settings=await store.settings(),phone=normalizePhone(p.From||'');
    if(p.To!==process.env.TWILIO_PHONE_NUMBER)return new Response('Number mismatch',{status:403});
    const selected=aiEnabled()&&phone&&(settings.inboundMode==='always'||settings.inboundMode==='allowlist'&&allowlisted(phone));
    if(!selected) {
      const previous=settings.previousResolvedVoiceUrl||settings.previousVoiceUrl;
      if(previous&&!new URL(previous).pathname.startsWith('/api/twilio/ai/')){const r=new twilio.twiml.VoiceResponse();r.redirect({method:settings.previousVoiceMethod},previous);return xml(r.toString());}
      return xml(fallbackTwiml());
    }
    const existing=(await store.sessions()).find(s=>s.callSid===p.CallSid);if(existing)return xml(existing.endedAt?fallbackTwiml('completed'):relayTwiml(existing));
    const agent=(await store.agents()).find(a=>a.id===settings.inboundAgentId&&a.config.enabled);if(!agent)return xml(fallbackTwiml());
    const lead=await store.leadByPhone(phone);const session=newSession(agent,lead,'inbound');session.callSid=p.CallSid;await store.createSession(session);await store.event(session.id,'inbound_received');
    // Set a per-call callback, preserving the phone number's previous global routing/status configuration.
    await voiceClient().calls(p.CallSid).update({statusCallback:`${publicAppUrl()}/api/twilio/ai/status?session=${session.id}`,statusCallbackMethod:'POST',timeLimit:agent.config.maxDurationSeconds+90});
    return xml(relayTwiml(session));
  }catch{return xml(fallbackTwiml());}}
