import { aiAuth, aiError } from '@/lib/ai/http';
import { getStore } from '@/lib/ai/store';
import { readiness } from '@/lib/ai/readiness';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){const denied=await aiAuth();if(denied)return denied;
  try{const agents=(await getStore().agents()).filter(a=>a.config.enabled);
    const providers=[...new Set(agents.map(a=>a.config.llmProvider))];
    const checks=await Promise.all(providers.map(provider=>readiness(true,agents.filter(a=>a.config.llmProvider===provider).flatMap(a=>[a.config.model,...(a.config.escalationModel?[a.config.escalationModel]:[])]),provider)));
    const primary=checks[0]||await readiness(true);
    return Response.json({...primary,...(checks.length?{missing:[...new Set(checks.flatMap(c=>c.missing))],configured:checks.every(c=>c.configured),liveReady:checks.every(c=>c.liveReady),requestedModelsAvailable:checks.every(c=>c.requestedModelsAvailable),availableModels:checks.flatMap(c=>c.availableModels)}:{}),providers:checks.map(c=>({provider:c.provider,missing:c.missing,requestedModelsAvailable:c.requestedModelsAvailable}))},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return aiError(e);}}
