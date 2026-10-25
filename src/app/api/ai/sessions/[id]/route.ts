import { aiAuth, aiError, uuid } from '@/lib/ai/http';
import { getStore, snapshot } from '@/lib/ai/store';
import { CostEngine } from '@/lib/ai/cost';
import { voiceClient } from '@/lib/ai/providers';
export const runtime='nodejs';export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Context){const denied=await aiAuth();if(denied)return denied;
  try{const id=uuid.parse((await params).id),store=getStore(),data=await snapshot(store,id);if(!data)return Response.json({error:'Session not found'},{status:404});return Response.json({...data,cost:await new CostEngine(store).getCostBreakdown(id)},{headers:{'Cache-Control':'no-store'}});}catch(e){return aiError(e);}}
export async function DELETE(request:Request,{params}:Context){const denied=await aiAuth(request);if(denied)return denied;
  try{const id=uuid.parse((await params).id),store=getStore(),s=await store.session(id);if(!s)return Response.json({error:'Session not found'},{status:404});if(s.endedAt)return Response.json({ok:true});
    if(s.callSid&&!s.simulation)await voiceClient().calls(s.callSid).update({status:s.connectionStatus==='queued'?'canceled':'completed'});
    else if(!s.simulation)return Response.json({error:'Call creation result is uncertain. Reconcile before releasing the reservation.'},{status:409});
    await store.patchSession(id,{state:'CANCELED',endedAt:new Date().toISOString()});await store.event(id,'operator_end');return Response.json({ok:true});
  }catch(e){return aiError(e);}}
