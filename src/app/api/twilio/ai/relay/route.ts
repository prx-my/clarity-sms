import { upgradeWebSocket } from '@vercel/functions';
import { aiEnabled } from '@/lib/ai/config';
import { handleRelaySocket, validRelayHandshake } from '@/lib/ai/gateway';
import { getStore } from '@/lib/ai/store';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

export async function GET(request:Request) {
  if(!aiEnabled()||process.env.AI_GATEWAY_MODE!=='vercel')return new Response('AI voice unavailable',{status:503});
  const url=new URL(request.url);
  if(!validRelayHandshake(request.headers.get('x-twilio-signature')||'',url.pathname+url.search))return new Response('Invalid signature',{status:403});
  if(request.headers.get('upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket upgrade required',{status:426});
  try{return await upgradeWebSocket(ws=>handleRelaySocket(ws,getStore(),{maxLifetimeMs:270000}).done,{maxPayload:32768});}
  catch{return new Response('WebSocket runtime unavailable',{status:503});}
}
