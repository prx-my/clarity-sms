import dotenv from 'dotenv';
dotenv.config({path:'.env.local',quiet:true});dotenv.config({quiet:true});
import { createServer, request as proxyRequest } from 'node:http';
import twilio from 'twilio';
import { WebSocketServer, WebSocket } from 'ws';
import { getStore } from '../src/lib/ai/store';
import { aiEnabled } from '../src/lib/ai/config';
import { AgentRuntime, relayEvent } from '../src/lib/ai/runtime';
import { verifyTicket } from '../src/lib/ai/telephony';
import { llmConnection } from '../src/lib/ai/llm-connection';

const store=getStore(),active=new Map<string,{ws:WebSocket;runtime:AgentRuntime}>();
const publicUrl=process.env.AI_WEBSOCKET_PUBLIC_URL,auth=process.env.TWILIO_AUTH_TOKEN;
const server=createServer((req,res)=>{
  // A secret-protected readiness probe contains no keys, phone numbers or transcripts.
  if(req.url==='/health'&&req.headers['x-ai-health']===process.env.AI_GATEWAY_SECRET&&process.env.AI_GATEWAY_SECRET){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ready:aiEnabled()&&!!llmConnection().apiKey,provider:llmConnection().provider,active:active.size}));}
  else if(req.url?.split('?')[0]==='/health'){res.writeHead(404);res.end();}
  else if(process.env.AI_PROXY_APP_URL){
    // Optional local-demo proxy lets one TLS tunnel serve Next.js and /relay.
    // The upstream is fixed by trusted server configuration, never caller input.
    const upstream=new URL(process.env.AI_PROXY_APP_URL);
    if(upstream.protocol!=='http:'||!['127.0.0.1','localhost'].includes(upstream.hostname)){res.writeHead(503);res.end('Invalid local upstream');return;}
    const forwarded=proxyRequest({hostname:upstream.hostname,port:upstream.port||80,path:req.url,method:req.method,headers:{...req.headers,connection:'close'}},response=>{
      res.writeHead(response.statusCode||502,response.headers);response.pipe(res);
    });
    forwarded.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Application unavailable');});
    req.on('aborted',()=>forwarded.destroy());res.on('close',()=>forwarded.destroy());req.pipe(forwarded);
  }else {res.writeHead(404);res.end();}
});
const sockets=new WebSocketServer({noServer:true,maxPayload:32768,perMessageDeflate:false});
server.on('upgrade',(req,socket,head)=>{
  if(!aiEnabled()||!publicUrl||!auth||active.size>=1){socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');return;}
  const configured=new URL(publicUrl),incoming=req.url||'';
  const signature=typeof req.headers['x-twilio-signature']==='string'?req.headers['x-twilio-signature']:'';
  // Twilio signs the public handshake URL. Accept documented WSS/HTTPS proxy representations, never Host headers.
  const urls=[publicUrl,publicUrl.replace(/^wss:/,'https:')];
  const valid=incoming===configured.pathname+configured.search&&urls.some(url=>twilio.validateRequest(auth,signature,url,{}));
  if(!valid){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  sockets.handleUpgrade(req,socket,head,ws=>sockets.emit('connection',ws));
});
sockets.on('connection',ws=>{
  let runtime:AgentRuntime|null=null,sessionId:string|null=null,initialization:Promise<void>|null=null,setupPending=false,frames=0,windowStart=Date.now();
  const setupTimeout=setTimeout(()=>ws.close(1008,'Setup required'),8000);
  ws.on('message',async raw=>{
    try {
      if(Date.now()-windowStart>1000){frames=0;windowStart=Date.now();}if(++frames>100){ws.close(1008,'Rate limit');return;}
      const parsed=relayEvent.safeParse(JSON.parse(raw.toString()));if(!parsed.success){ws.close(1008,'Invalid event');return;}
      if(parsed.data.type==='setup') {
        if(runtime||setupPending){ws.close(1008,'Duplicate setup');return;}setupPending=true;
        const e=parsed.data,id=e.customParameters?.sessionId,token=e.customParameters?.ticket;
        if(!id||!token||e.accountSid!==process.env.TWILIO_ACCOUNT_SID||!verifyTicket(token,id,e.callSid)){ws.close(1008,'Invalid session');return;}
        const session=await store.session(id);
        if(!session||session.simulation||session.callSid!==e.callSid||session.endedAt||active.has(id)){ws.close(1008,'Session unavailable');return;}
        sessionId=id;
        runtime=new AgentRuntime(store,id,{
          text(token,last){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'text',token,last,interruptible:true,preemptible:true}));},
          end(reason){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'end',handoffData:JSON.stringify({reason})}));},
          close(){ws.close(1000);},
        });
        active.set(id,{ws,runtime});clearTimeout(setupTimeout);initialization=runtime.start();await initialization;
      } else if(runtime){await initialization;await runtime.handle(parsed.data);}
      else ws.close(1008,'Setup required');
    } catch {if(runtime)await runtime.fail('gateway_error').catch(()=>{});ws.close(1011,'Voice service unavailable');}
  });
  ws.on('close',()=>{clearTimeout(setupTimeout);if(sessionId)active.delete(sessionId);void runtime?.disconnect().catch(()=>console.error('AI session cleanup failed'));});
  ws.on('error',()=>{ws.close(1011);});
});
let ticking=false;
const timer=setInterval(async()=>{
  if(ticking)return;ticking=true;
  try{await Promise.all([...active.values()].map(async({runtime})=>{try{await runtime.tick();}catch{await runtime.fail('watchdog_error');}}));}finally{ticking=false;}
},5000);
const port=Number(process.env.AI_GATEWAY_PORT||3001);
server.listen(port,'0.0.0.0',()=>console.log(`ConversationRelay gateway listening on ${port}. AI ${aiEnabled()?'enabled':'disabled'}.`));
async function shutdown(){clearInterval(timer);for(const {runtime,ws} of active.values()){await runtime.fail('gateway_shutdown').catch(()=>{});ws.close(1012);}server.close();}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
