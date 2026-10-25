import { z } from 'zod';
import { aiAuth, aiError } from '@/lib/ai/http';
import { getStore, usageEvent } from '@/lib/ai/store';
import { applyStatus } from '@/lib/ai/telephony';
import { voiceClient } from '@/lib/ai/providers';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
export const runtime='nodejs';
export async function POST(request:Request){const denied=await aiAuth(request);if(denied)return denied;
  try{const {id}=z.object({id:z.uuid()}).parse(await request.json()),store=getStore(),s=await store.session(id);if(!s||s.simulation)return Response.json({error:'Real session required'},{status:400});
    if(!s.callSid)return Response.json({error:'Call creation result is unknown. Check the Twilio console for this session’s webhook URL and wait for its signed callback; do not retry or release its reservation.'},{status:409});
    const c=await voiceClient().calls(s.callSid).fetch();await applyStatus(store,id,{AccountSid:c.accountSid,CallSid:c.sid,CallStatus:c.status,CallDuration:c.duration||'0'});
    if(c.price&&c.priceUnit==='USD') {
      const event=usageEvent(id,'voice_duration',`twilio_${s.direction}`,c.duration||'0','second',parsePhoneNumberFromString(s.phone)?.country||'UNKNOWN',{source:'Twilio Call resource price'});
      event.finalizedUsd=c.price.replace(/^-/, '');event.estimated=false;await store.recordUsage(event);
    }
    return Response.json({ok:true});
  }catch(e){return aiError(e);}}
