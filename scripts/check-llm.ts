import dotenv from 'dotenv';dotenv.config({path:'.env.local',quiet:true});dotenv.config({quiet:true});
import { PostgresStore } from '../src/lib/ai/store';
import { OpenAiLlm } from '../src/lib/ai/llm';
import { llmTools } from '../src/lib/ai/tools';
async function main(){
  const profile=(await new PostgresStore().agents()).find(a=>a.config.name==='Schrader — Consented owner test');if(!profile)throw new Error('Test profile missing');
  const started=Date.now();let output='';
  const result=await new OpenAiLlm().complete({model:profile.config.model,config:profile.config,messages:[{role:'system',content:'You are a disclosed AI voice assistant. Use lookup_lead exactly once to read the contact assigned to this diagnostic. Do not invent a lead or execute other actions.'},{role:'user',content:'Please look up my assigned lead record.'}],tools:llmTools(['lookup_lead']),signal:AbortSignal.timeout(18000),onText:async text=>{output+=text;}});
  const valid=result.tools.some(t=>{if(t.name!=='lookup_lead')return false;try{const args=JSON.parse(t.arguments);return args&&typeof args==='object'&&!Array.isArray(args)&&Object.keys(args).length===0;}catch{return false;}});
  console.log(JSON.stringify({provider:profile.config.llmProvider,model:profile.config.model,streamWorking:true,toolCallingWorking:valid,usageReceived:!!result.usage,inputTokens:result.usage?.input,outputTokens:result.usage?.output,latencyMs:Date.now()-started,textProduced:!!output,externalActionsExecuted:false,...(!valid?{diagnosticToolCalls:result.tools,finishReason:result.finishReason}:{})}));
  if(!valid)process.exitCode=1;
}
void main().catch(error=>{console.error('LLM diagnostic failed',{type:error?.name,status:error?.status||null,code:error?.code||null});process.exitCode=1;});
