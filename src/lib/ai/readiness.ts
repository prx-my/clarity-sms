import { defaultLlmProvider, llmClient, llmConnection, type LlmProviderName } from './llm-connection';
import { aiEnabled, requiredConfiguration } from './config';
export async function readiness(verify=false,models:string[]=[],provider:LlmProviderName=defaultLlmProvider()) {
  const missing=requiredConfiguration(provider),enabled=aiEnabled();
  let gateway:'unverified'|'ready'|'unavailable'='unverified';
  let availableModels:string[]=[];
  let providerReady=false;
  if(verify&&process.env.AI_WEBSOCKET_PUBLIC_URL&&process.env.AI_GATEWAY_SECRET) {
    try{const url=new URL(process.env.AI_WEBSOCKET_PUBLIC_URL.replace(/^wss:/,'https:'));url.pathname=process.env.AI_GATEWAY_MODE==='vercel'?'/api/twilio/ai/health':'/health';url.search='';
      const res=await fetch(url,{headers:{'x-ai-health':process.env.AI_GATEWAY_SECRET},signal:AbortSignal.timeout(4000),cache:'no-store'});if(res.ok&&(await res.json()).ready)gateway='ready';else gateway='unavailable';}catch{gateway='unavailable';}
  }
  if(verify&&llmConnection(provider).apiKey){try{const data=await llmClient(provider,5000).models.list();availableModels=data.data.map(m=>m.id);providerReady=true;}catch{availableModels=[];}}
  const relayAcknowledged=process.env.AI_CONVERSATION_RELAY_ACKNOWLEDGED==='1';
  const configured=enabled&&!missing.length&&relayAcknowledged;
  return {provider,enabled,missing,gateway,relayAcknowledged,availableModels,configured,requestedModelsAvailable:!verify?null:providerReady&&models.every(m=>availableModels.includes(m)),
    liveReady:configured&&verify&&gateway==='ready'&&providerReady&&models.every(m=>availableModels.includes(m)),
    simulation:process.env.DEMO_MODE==='1'};
}
