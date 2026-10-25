import { getStore } from '@/lib/ai/store';
import { applyStatus, validateAiWebhook } from '@/lib/ai/telephony';
import { uuid } from '@/lib/ai/http';
import { collect } from '@/lib/monitoring/store';
import { voiceEvent } from '@/lib/monitoring/model';
export const runtime='nodejs';
export async function POST(request:Request){const p=Object.fromEntries(await request.formData()) as Record<string,string>;if(!validateAiWebhook(request,p))return new Response('Invalid signature',{status:403});
  try{const id=uuid.parse(new URL(request.url).searchParams.get('session'));await applyStatus(getStore(),id,p);const s=await getStore().session(id);if(s)await collect(voiceEvent(p,{sessionId:id,agentId:s.agentId,contactId:s.contactId}));return new Response('<Response/>',{headers:{'Content-Type':'text/xml'}});}catch{return new Response('Status persistence failed',{status:500});}}
