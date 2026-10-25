import type { AgentConfig } from '../src/lib/ai/config';
import { MemoryStore, newSession } from '../src/lib/ai/store';
import { AgentRuntime } from '../src/lib/ai/runtime';
import { ToolRegistry, type Effects } from '../src/lib/ai/tools';
import type { CalendarProvider, Slot } from '../src/lib/ai/providers';
import type { LlmProvider, LlmResult } from '../src/lib/ai/llm';
import type { Transcript } from '../src/lib/ai/types';

export class ScriptedLlm implements LlmProvider {
  calls=0; constructor(public steps:(string|Error|((o:Parameters<LlmProvider['complete']>[0])=>Promise<LlmResult>))[]=[]){ }
  async complete(o:Parameters<LlmProvider['complete']>[0]):Promise<LlmResult>{this.calls++;const step=this.steps.shift()??'What would you like your website to help with?';if(step instanceof Error)throw step;if(typeof step==='function')return step(o);await o.onText(step);return {text:step,tools:[],usage:{input:100,cached:20,output:15,reasoning:0},requestId:`test-${this.calls}`,finishReason:'stop'};}
}
export async function fixture(steps:ConstructorParameters<typeof ScriptedLlm>[0]=[],override:Partial<AgentConfig>={}) {
  const store=new MemoryStore(),agent=(await store.agents())[0];Object.assign(agent.config,{enabled:true,followupEnabled:true,demoUrl:'https://example.com/approved-demo',transferNumber:'+14155550199'},override);await store.saveAgent(agent.id,agent.config);
  const lead=await store.leadByPhone('+14155550143');lead.name='Alex';await store.saveLead(lead);
  const session=newSession(agent,lead,'inbound',true);session.callSid='CA'+'a'.repeat(32);await store.createSession(session);
  const spoken:{token:string;last:boolean}[]=[],ended:string[]=[],effectsCount={sms:0,booking:0,transfer:0,end:0};
  const slot:Slot={id:'real-test-slot',start:new Date(Date.now()+86400000).toISOString(),end:new Date(Date.now()+86400000+1800000).toISOString(),label:'Monday, October 26, 2026 at 2:00 PM EDT'};
  const calendar:CalendarProvider={async availability(){return [slot];},async book(){effectsCount.booking++;return{id:'verified-test-booking',url:null};}};
  const effects:Effects={async sms(){effectsCount.sms++;return{sid:'SM'+'a'.repeat(32),status:'queued'};},async transfer(){effectsCount.transfer++;},async end(){effectsCount.end++;}};
  const llm=new ScriptedLlm(steps),tools=new ToolRegistry(store,calendar,effects);
  const runtime=new AgentRuntime(store,session.id,{text(token,last){spoken.push({token,last});},end(reason){ended.push(reason);},close(){}},llm,tools);
  return {store,agent,lead,session,runtime,tools,llm,spoken,ended,slot,effectsCount};
}
export function message(sessionId:string,role:Transcript['role'],text:string):Transcript{return{id:crypto.randomUUID(),sessionId,role,text,generatedText:role==='assistant'?text:null,delivery:role==='assistant'?'submitted':'received',interrupted:false,createdAt:new Date().toISOString()};}
export const signal=()=>new AbortController().signal;
