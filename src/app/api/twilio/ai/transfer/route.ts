import twilio from 'twilio';
import { getStore } from '@/lib/ai/store';
import { xml, fallbackTwiml, validateAiWebhook } from '@/lib/ai/telephony';
import { publicAppUrl } from '@/lib/twilio';
import { normalizePhone } from '@/lib/phone';
import { uuid } from '@/lib/ai/http';
export const runtime='nodejs';
export async function POST(request:Request){const p=Object.fromEntries(await request.formData()) as Record<string,string>;if(!validateAiWebhook(request,p))return new Response('Invalid signature',{status:403});
  try{const id=uuid.parse(new URL(request.url).searchParams.get('session')),s=await getStore().session(id);if(!s||s.callSid!==p.CallSid||s.state!=='HUMAN_HANDOFF'||!normalizePhone(s.agentSnapshot.transferNumber))return xml(fallbackTwiml());
    const r=new twilio.twiml.VoiceResponse();r.say('Please hold while I try our team.');r.dial({timeout:20,action:`${publicAppUrl()}/api/twilio/ai/transfer-result?session=${id}`,method:'POST'}).number(s.agentSnapshot.transferNumber);return xml(r.toString());
  }catch{return xml(fallbackTwiml());}}
