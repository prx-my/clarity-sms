import { aiAuth, aiError } from '@/lib/ai/http';
import { getStore } from '@/lib/ai/store';
import { readiness } from '@/lib/ai/readiness';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){const denied=await aiAuth();if(denied)return denied;
  try{const agents=await getStore().agents();return Response.json(await readiness(true,agents.filter(a=>a.config.enabled).flatMap(a=>[a.config.model,...(a.config.escalationModel?[a.config.escalationModel]:[])])));}catch(e){return aiError(e);}}
