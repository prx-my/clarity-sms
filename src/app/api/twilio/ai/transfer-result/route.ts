import twilio from 'twilio';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { getStore, usageEvent } from '@/lib/ai/store';
import { xml, fallbackTwiml, validateAiWebhook } from '@/lib/ai/telephony';
import { uuid } from '@/lib/ai/http';
export const runtime='nodejs';
export async function POST(request:Request){const p=Object.fromEntries(await request.formData()) as Record<string,string>;if(!validateAiWebhook(request,p))return new Response('Invalid signature',{status:403});
  try{const id=uuid.parse(new URL(request.url).searchParams.get('session')),store=getStore(),s=await store.session(id);if(!s||s.callSid!==p.CallSid)return new Response('Call mismatch',{status:403});
    const seconds=Math.max(0,Math.min(86400,Number(p.DialCallDuration)||0));
    await store.recordUsage(usageEvent(id,`transfer:${p.DialCallSid||'unknown'}`,'twilio_transfer',String(seconds),'second',parsePhoneNumberFromString(s.agentSnapshot.transferNumber)?.country||'UNKNOWN'));
    await store.event(id,'transfer_result',{status:p.DialCallStatus||'unknown'});await store.patchSession(id,{state:'COMPLETED',outcome:'Human requested',endedAt:s.endedAt||new Date().toISOString()});
    if(p.DialCallStatus==='completed')return xml(fallbackTwiml('completed'));
    const r=new twilio.twiml.VoiceResponse();r.say("Our team isn't available on this line right now. Please call again during business hours. Thank you.");r.hangup();return xml(r.toString());
  }catch{return xml(fallbackTwiml());}}
