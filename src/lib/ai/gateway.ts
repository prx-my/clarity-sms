import twilio from 'twilio';
import { WebSocket } from 'ws';
import { AgentRuntime, relayEvent } from './runtime';
import { verifyTicket } from './telephony';
import type { Store } from './store';

export function validRelayHandshake(signature:string,path:string) {
  const publicUrl=process.env.AI_WEBSOCKET_PUBLIC_URL,auth=process.env.TWILIO_AUTH_TOKEN;
  if(!publicUrl||!auth||!signature)return false;
  try{const url=new URL(publicUrl);return path===url.pathname+url.search&&[publicUrl,publicUrl.replace(/^wss:/,'https:')].some(value=>twilio.validateRequest(auth,signature,value,{}));}catch{return false;}
}

export function handleRelaySocket(ws:WebSocket,store:Store,options:{maxLifetimeMs?:number}={}) {
  let runtime:AgentRuntime|null=null,initialization:Promise<void>|null=null,setupPending=false,frames=0,windowStart=Date.now(),closed=false,ticking=false;
  let resolveDone:()=>void=()=>{};
  const done=new Promise<void>(resolve=>{resolveDone=resolve;});
  const setupTimeout=setTimeout(()=>ws.close(1008,'Setup required'),8000);
  const watchdog=setInterval(async()=>{
    if(!runtime||ticking||closed)return;ticking=true;
    try{await runtime.tick();}catch{await runtime.fail('watchdog_error').catch(()=>{});}finally{ticking=false;}
  },5000);
  const lifetime=options.maxLifetimeMs?setTimeout(()=>void shutdown('gateway_duration_limit'),options.maxLifetimeMs):null;
  async function shutdown(reason='gateway_shutdown') {await runtime?.fail(reason).catch(()=>{});ws.close(1012);}
  ws.on('message',async raw=>{
    if(closed)return;
    try{
      if(Date.now()-windowStart>1000){frames=0;windowStart=Date.now();}
      if(++frames>100){ws.close(1008,'Rate limit');return;}
      const parsed=relayEvent.safeParse(JSON.parse(raw.toString()));
      if(!parsed.success){ws.close(1008,'Invalid event');return;}
      if(parsed.data.type==='setup'){
        if(runtime||setupPending){ws.close(1008,'Duplicate setup');return;}setupPending=true;
        const e=parsed.data,id=e.customParameters?.sessionId,token=e.customParameters?.ticket;
        if(!id||!token||e.accountSid!==process.env.TWILIO_ACCOUNT_SID||!verifyTicket(token,id,e.callSid)){ws.close(1008,'Invalid session');return;}
        const session=await store.session(id);
        if(!session||session.simulation||session.callSid!==e.callSid||session.endedAt||!await store.claimRelay(id,crypto.randomUUID())){ws.close(1008,'Session unavailable');return;}
        if(closed)return;
        runtime=new AgentRuntime(store,id,{
          text(token,last){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'text',token,last,interruptible:true,preemptible:true}));},
          end(reason){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'end',handoffData:JSON.stringify({reason})}));},
          close(){ws.close(1000);},
        });
        clearTimeout(setupTimeout);initialization=runtime.start();await initialization;
      }else if(runtime){await initialization;if(!closed)await runtime.handle(parsed.data);}
      else ws.close(1008,'Setup required');
    }catch{await runtime?.fail('gateway_error').catch(()=>{});ws.close(1011,'Voice service unavailable');}
  });
  ws.on('close',()=>{
    closed=true;clearTimeout(setupTimeout);clearInterval(watchdog);if(lifetime)clearTimeout(lifetime);
    // Keep the Vercel handler alive until durable cleanup has completed.
    void (async()=>{try{await initialization;await runtime?.disconnect();}catch{console.error('AI session cleanup failed');}finally{resolveDone();}})();
  });
  ws.on('error',()=>ws.close(1011));
  return {done,shutdown};
}
