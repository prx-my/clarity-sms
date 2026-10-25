import { aiAuth, aiError } from '@/lib/ai/http';
import { getStore } from '@/lib/ai/store';
import { workspaceSchema } from '@/lib/ai/config';
export const runtime='nodejs';
export async function PUT(request:Request){const denied=await aiAuth(request);if(denied)return denied;
  try{const store=getStore(),previous=await store.settings(),config=workspaceSchema.parse(await request.json());
    // Routing snapshots can only be written by the Twilio routing operation.
    await store.saveSettings({...config,previousVoiceUrl:previous.previousVoiceUrl,previousVoiceMethod:previous.previousVoiceMethod,previousVoiceApplicationSid:previous.previousVoiceApplicationSid,previousResolvedVoiceUrl:previous.previousResolvedVoiceUrl,phoneNumberSid:previous.phoneNumberSid,routingApplied:previous.routingApplied});return Response.json({ok:true});
  }catch(e){return aiError(e);}}
