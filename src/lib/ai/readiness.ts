import { defaultLlmProvider, llmClient, llmConnection, type LlmProviderName } from './llm-connection';
import { aiEnabled, requiredConfiguration } from './config';
export async function readiness(verify=false,models:string[]=[],provider:LlmProviderName=defaultLlmProvider()) {
  const missing=requiredConfiguration(provider),enabled=aiEnabled();
  let gateway:'unverified'|'ready'|'unavailable'='unverified';
  let availableModels:string[]=[];
  if(verify&&process.env.AI_WEBSOCKET_PUBLIC_URL&&process.env.AI_GATEWAY_SECRET) {
    try{const url=new URL(process.env.AI_WEBSOCKET_PUBLIC_URL.replace(/^wss:/,'https:'));url.pathname='/health';url.search='';
      const res=await fetch(url,{headers:{'x-ai-health':process.env.AI_GATEWAY_SECRET},signal:AbortSignal.timeout(4000),cache:'no-store'});if(res.ok&&(await res.json()).ready)gateway='ready';else gateway='unavailable';}catch{gateway='unavailable';}
  }
  if(verify&&llmConnection(provider).apiKey){try{const data=await llmClient(provider,5000).models.list();availableModels=data.data.map(m=>m.id);}catch{availableModels=[];}}
  const relayAcknowledged=process.env.AI_CONVERSATION_RELAY_ACKNOWLEDGED==='1';
  return {provider,enabled,missing,gateway,relayAcknowledged,availableModels,requestedModelsAvailable:!verify?null:models.every(m=>availableModels.includes(m)),
    liveReady:enabled&&!missing.length&&relayAcknowledged&&(!verify||(gateway==='ready'&&models.every(m=>availableModels.includes(m)))),
    simulation:process.env.DEMO_MODE==='1'};
}
