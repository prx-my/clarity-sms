import { z } from 'zod';
import { aiAuth, aiError } from '@/lib/ai/http';
import { getStore } from '@/lib/ai/store';
import { voiceClient } from '@/lib/ai/providers';
import { publicAppUrl, twilioNumber } from '@/lib/twilio';
export const runtime='nodejs';
export async function POST(request:Request){const denied=await aiAuth(request);if(denied)return denied;
  try{const {action}=z.object({action:z.enum(['apply','restore'])}).parse(await request.json());if(process.env.DEMO_MODE==='1')return Response.json({error:'Twilio routing is unavailable in preview'},{status:403});
    const store=getStore(),settings=await store.settings(),client=voiceClient();
    if(action==='restore'){
      if(!settings.phoneNumberSid||!settings.routingApplied)return Response.json({error:'No saved routing snapshot to restore'},{status:400});
      await client.incomingPhoneNumbers(settings.phoneNumberSid).update({voiceUrl:settings.previousVoiceUrl,voiceMethod:settings.previousVoiceMethod,voiceApplicationSid:settings.previousVoiceApplicationSid});
      await store.saveSettings({...settings,inboundMode:'normal',routingApplied:false});return Response.json({ok:true});
    }
    if(settings.inboundMode==='normal'||!(await store.agents()).some(a=>a.id===settings.inboundAgentId&&a.config.enabled))return Response.json({error:'Save an AI inbound mode and an enabled inbound agent first'},{status:400});
    if(!settings.routingApplied){const [number]=await client.incomingPhoneNumbers.list({phoneNumber:twilioNumber(),limit:1});if(!number)return Response.json({error:'Configured Twilio number is unavailable'},{status:400});
      let resolved=number.voiceUrl||'';if(number.voiceApplicationSid){const app=await client.applications(number.voiceApplicationSid).fetch();resolved=app.voiceUrl||'';}
      Object.assign(settings,{previousVoiceUrl:number.voiceUrl||'',previousVoiceMethod:number.voiceMethod==='GET'?'GET':'POST',previousResolvedVoiceUrl:resolved,previousVoiceApplicationSid:number.voiceApplicationSid||'',phoneNumberSid:number.sid});
      // Persist the restoration snapshot BEFORE changing external routing.
      await store.saveSettings(settings);
    }
    await client.incomingPhoneNumbers(settings.phoneNumberSid).update({voiceUrl:`${publicAppUrl()}/api/twilio/ai/inbound`,voiceMethod:'POST',voiceApplicationSid:''});
    await store.saveSettings({...settings,routingApplied:true});return Response.json({ok:true});
  }catch(e){return aiError(e);}}
