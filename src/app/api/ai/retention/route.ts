import { aiAuth, aiError } from '@/lib/ai/http';
import { getStore } from '@/lib/ai/store';
export const runtime='nodejs';
export async function POST(request:Request){const denied=await aiAuth(request);if(denied)return denied;try{const store=getStore(),settings=await store.settings();await store.prune(new Date(Date.now()-settings.retentionDays*86400000).toISOString());return Response.json({ok:true});}catch(e){return aiError(e);}}
