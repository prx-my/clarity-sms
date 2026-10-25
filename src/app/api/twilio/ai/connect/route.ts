import { getStore } from '@/lib/ai/store';
import { aiEnabled } from '@/lib/ai/config';
import { xml, relayTwiml, fallbackTwiml, validateAiWebhook } from '@/lib/ai/telephony';
import { uuid } from '@/lib/ai/http';
export const runtime='nodejs';
export async function POST(request:Request){const p=Object.fromEntries(await request.formData()) as Record<string,string>;if(!validateAiWebhook(request,p))return new Response('Invalid signature',{status:403});
  try{const id=uuid.parse(new URL(request.url).searchParams.get('session')),store=getStore(),s=await store.session(id);
    if(!s||s.simulation||s.endedAt||!aiEnabled()||p.To!==s.phone||p.From!==process.env.TWILIO_PHONE_NUMBER)return xml(fallbackTwiml());
    if(!await store.bindCall(id,p.CallSid))return new Response('Call mismatch',{status:403});
    if(p.AnsweredBy?.startsWith('machine')){await store.patchSession(id,{state:'VOICEMAIL',outcome:'Voicemail'});return xml(fallbackTwiml('completed'));}
    return xml(relayTwiml({...s,callSid:p.CallSid}));
  }catch{return xml(fallbackTwiml());}}
