import { aiAuth, uuid, aiError } from '@/lib/ai/http';
import { getStore, snapshot } from '@/lib/ai/store';
import { CostEngine } from '@/lib/ai/cost';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=30;
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const denied=await aiAuth();if(denied)return denied;
  try{const id=uuid.parse((await params).id),store=getStore();if(!await store.session(id))return Response.json({error:'Not found'},{status:404});
    const encoder=new TextEncoder();let timer:ReturnType<typeof setTimeout>|undefined,stopped=false;
    const stream=new ReadableStream({async start(controller){const until=Date.now()+25000;
      const cleanup=()=>{stopped=true;if(timer)clearTimeout(timer);};request.signal.addEventListener('abort',cleanup,{once:true});
      const send=async()=>{if(stopped)return;try{const data=await snapshot(store,id);if(stopped)return;controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify({...data,cost:await new CostEngine(store).getCostBreakdown(id)})}\n\n`));
        if(Date.now()>until||data?.session.endedAt){cleanup();controller.close();}else timer=setTimeout(send,2000);
      }catch{cleanup();try{controller.enqueue(encoder.encode('event: unavailable\ndata: {}\n\n'));controller.close();}catch{}}};await send();},cancel(){stopped=true;if(timer)clearTimeout(timer);}});
    return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no',Connection:'keep-alive'}});
  }catch(e){return aiError(e);}}
