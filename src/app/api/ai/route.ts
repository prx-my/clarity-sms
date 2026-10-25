import { aiAuth, aiError } from '@/lib/ai/http';
import { getStore } from '@/lib/ai/store';
import { CostEngine } from '@/lib/ai/cost';
import { readiness } from '@/lib/ai/readiness';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){const denied=await aiAuth();if(denied)return denied;
  try{const store=getStore(),engine=new CostEngine(store);const [agents,settings,sessions,rates,metrics,period,leads]=await Promise.all([store.agents(),store.settings(),store.sessions(),store.rates(),engine.getAgentCostMetrics(),engine.getMonthlyUsage(),store.getLeads()]);
    return Response.json({agents,settings,sessions,rates,metrics,period,leads,readiness:await readiness()},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return aiError(e);}}
