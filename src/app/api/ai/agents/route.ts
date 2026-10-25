import { aiAuth, aiError, uuid } from '@/lib/ai/http';
import { getStore } from '@/lib/ai/store';
import { agentSchema } from '@/lib/ai/config';
export const runtime='nodejs';
export async function PUT(request:Request){const denied=await aiAuth(request);if(denied)return denied;
  try{const body=await request.json();const id=body.id?uuid.parse(body.id):crypto.randomUUID();const config=agentSchema.parse(body.config);
    return Response.json(await getStore().saveAgent(id,config));
  }catch(e){return aiError(e);}}
