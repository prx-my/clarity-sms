import dotenv from 'dotenv';
dotenv.config({path:'.env.local',quiet:true});dotenv.config({quiet:true});
import { createServer, request as proxyRequest } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { getStore } from '../src/lib/ai/store';
import { aiEnabled, requiredConfiguration } from '../src/lib/ai/config';
import { productionDeployment, productionEnvironmentReport } from '../src/lib/ai/deployment';
import { handleRelaySocket, validRelayHandshake } from '../src/lib/ai/gateway';
import { llmConnection } from '../src/lib/ai/llm-connection';

if(productionDeployment()) {
  const report=productionEnvironmentReport();
  // The gateway does not authenticate browser users or issue manual-dialer tokens.
  const gatewayErrors=report.errors.filter(e=>!['ADMIN_PASSWORD','SESSION_SECRET','TWILIO_API_KEY_SID','TWILIO_API_KEY_SECRET','TWILIO_TWIML_APP_SID'].some(key=>e.startsWith(key)));
  if(gatewayErrors.length){console.error('Gateway production configuration invalid:',gatewayErrors.join('; '));process.exit(1);}
}
const store=getStore(),active=new Map<WebSocket,ReturnType<typeof handleRelaySocket>>();
const publicUrl=process.env.AI_WEBSOCKET_PUBLIC_URL,auth=process.env.TWILIO_AUTH_TOKEN;
const server=createServer((req,res)=>{
  // A secret-protected readiness probe contains no keys, phone numbers or transcripts.
  if(req.url==='/health'&&req.headers['x-ai-health']===process.env.AI_GATEWAY_SECRET&&process.env.AI_GATEWAY_SECRET){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ready:aiEnabled()&&!requiredConfiguration().length&&!!llmConnection().apiKey,provider:llmConnection().provider,active:active.size}));}
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
  const signature=typeof req.headers['x-twilio-signature']==='string'?req.headers['x-twilio-signature']:'';
  if(!validRelayHandshake(signature,req.url||'')){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  sockets.handleUpgrade(req,socket,head,ws=>sockets.emit('connection',ws));
});
sockets.on('connection',ws=>{
  const connection=handleRelaySocket(ws,store);active.set(ws,connection);
  void connection.done.finally(()=>active.delete(ws));
});
const port=Number(process.env.AI_GATEWAY_PORT||3001);
server.listen(port,'0.0.0.0',()=>console.log(`ConversationRelay gateway listening on ${port}. AI ${aiEnabled()?'enabled':'disabled'}.`));
async function shutdown(){await Promise.all([...active.values()].map(connection=>connection.shutdown()));server.close();setTimeout(()=>process.exit(0),8000).unref();}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
