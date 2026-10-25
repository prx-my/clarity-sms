import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { z } from 'zod';
import { canTransition, isOptOut, terminalStates, wantsHuman } from './policy';
import { buildContext, routeModel } from './context';
import { CostEngine } from './cost';
import { disclosure } from './config';
import { OpenAiLlm, type LlmProvider } from './llm';
import { llmTools, ToolRegistry } from './tools';
import { usageEvent, type Store } from './store';
import type { State, Transcript, VoiceTransport } from './types';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export const relayEvent=z.discriminatedUnion('type',[
  z.object({type:z.literal('setup'),callSid:z.string().regex(/^CA[a-fA-F0-9]{32}$/),accountSid:z.string(),customParameters:z.record(z.string(),z.string()).optional()}).passthrough(),
  z.object({type:z.literal('prompt'),voicePrompt:z.string().max(6000),last:z.boolean(),lang:z.string().optional()}).passthrough(),
  z.object({type:z.literal('interrupt'),utteranceUntilInterrupt:z.string().max(10000),durationUntilInterruptMs:z.number().optional()}).passthrough(),
  z.object({type:z.literal('dtmf'),digit:z.string().max(1)}).passthrough(),
  z.object({type:z.literal('error'),description:z.string().max(2000)}).passthrough(),
]);
export class AgentRuntime {
  private controller:AbortController|null=null; private generation=0; private partial=''; private seenAt=0; private seenText='';
  private lastAssistant:Transcript|null=null; private lastActivity=Date.now(); private silencePrompts=0; private closed=false;
  private started=false; private failures=0; private queue=Promise.resolve(); private finishing=false;
  private pendingWrites=Promise.resolve();
  constructor(readonly store:Store,readonly sessionId:string,readonly transport:VoiceTransport,readonly llm:LlmProvider=new OpenAiLlm(),readonly tools:ToolRegistry=new ToolRegistry(store)) {}
  private async session(){const s=await this.store.session(this.sessionId);if(!s)throw new Error('session_missing');return s;}
  async transition(to:State) { const s=await this.session();if(!canTransition(s.state,to))return false;await this.store.patchSession(s.id,{state:to});await this.store.event(s.id,'state',{from:s.state,to});return true; }
  async start() {
    if(this.started)throw new Error('duplicate_setup');this.started=true;
    const s=await this.session();if(s.endedAt||terminalStates.includes(s.state))throw new Error('session_ended');
    await this.store.patchSession(s.id,{startedAt:s.startedAt||new Date().toISOString(),connectionStatus:'in-progress',memory:{...s.memory,relayStartedAt:new Date().toISOString()}});
    await this.transition('CONNECTED');await this.transition('AI_DISCLOSURE');await this.transition('GREETING');
    // Mandatory disclosure comes from trusted code, even when custom greetings are edited.
    await this.say(disclosure(s.agentSnapshot));await this.transition('DISCOVERY');
    await this.store.event(s.id,'relay_connected',{model:s.agentSnapshot.model,voice:s.agentSnapshot.voice});
  }
  async handle(raw:unknown) {
    const parsed=relayEvent.safeParse(raw);if(!parsed.success){await this.store.event(this.sessionId,'invalid_relay_event');return;}
    const event=parsed.data;
    if(event.type==='interrupt') {
      this.cancel();
      // Serialize writes against turn finalization so stale generated text cannot overwrite the heard prefix.
      this.pendingWrites=this.queue.catch(()=>{}).then(async()=>{
        if(this.lastAssistant){const m=this.lastAssistant,s=await this.session();
          if(m.text.includes('AI assistant')&&m.text.includes(s.agentSnapshot.company)&&(!event.utteranceUntilInterrupt.includes('AI assistant')||!event.utteranceUntilInterrupt.includes(s.agentSnapshot.company)))await this.store.patchSession(s.id,{memory:{...s.memory,disclosureNeedsRetry:true}});
          m.text=event.utteranceUntilInterrupt;m.interrupted=true;m.delivery='interrupted';await this.store.patchMessage(m.id,{text:m.text,interrupted:true,delivery:'interrupted'});}
        await this.store.event(this.sessionId,'interruption',{durationUntilInterruptMs:event.durationUntilInterruptMs??null});
      });
      await this.pendingWrites;this.lastActivity=Date.now();return;
    }
    if(event.type==='dtmf'){if(event.digit==='0')await this.human();else await this.store.event(this.sessionId,'dtmf',{digit:event.digit});return;}
    if(event.type==='error'){await this.fail('voice_transport_error');return;}
    if(event.type!=='prompt'||this.closed)return;
    this.lastActivity=Date.now();this.silencePrompts=0;
    if(!event.last){this.partial=event.voicePrompt.startsWith(this.partial)?event.voicePrompt:this.partial+' '+event.voicePrompt;return;}
    // ConversationRelay sends transcript segments. A final segment replaces the partial for its talk cycle.
    const text=(event.voicePrompt.startsWith(this.partial.trim())?event.voicePrompt:this.partial+' '+event.voicePrompt).trim();this.partial='';if(!text)return;
    if(text===this.seenText&&Date.now()-this.seenAt<1200)return;
    this.seenText=text;this.seenAt=Date.now();this.cancel();
    const g=this.generation,writes=this.pendingWrites;
    this.queue=this.queue.catch(()=>{}).then(async()=>{
      await writes;if(this.closed)return;
      await this.addMessage('user',text);
      if(isOptOut(text)){await this.optOut(text);return;}
      if(g!==this.generation)return;
      if(wantsHuman(text)){await this.human();return;}
      await this.turn(g);
    }).catch(async()=>{await this.fail('runtime_error');}).finally(()=>{if(g===this.generation)this.controller=null;});
    await this.queue;
  }
  private cancel(){this.generation++;this.controller?.abort();this.controller=null;}
  private async addMessage(role:'user'|'assistant',text:string) {
    const message:Transcript={id:crypto.randomUUID(),sessionId:this.sessionId,role,text,generatedText:role==='assistant'?text:null,interrupted:false,delivery:role==='user'?'received':'submitted',createdAt:new Date().toISOString()};
    await this.store.addMessage(message);if(role==='assistant')this.lastAssistant=message;return message;
  }
  async say(text:string) { if(this.closed)return;this.transport.text(text,true);await this.addMessage('assistant',text); }
  private async turn(g:number) {
    let s=await this.session();if(s.endedAt||terminalStates.includes(s.state))return;
    const lead=await this.store.lead(s.contactId);if(!lead)return this.fail('lead_unavailable');
    // Inbound callers may still ask for support after opting out; never resume outreach.
    const controller=new AbortController();this.controller=controller;
    const budget=await new CostEngine(this.store).evaluateBudget(s);
    if(budget.exceeded)await this.store.event(s.id,'budget_warning',{reasons:budget.reasons,action:budget.action});
    const previousUsage=await this.store.usage(s.id),requests=new Set(previousUsage.filter(u=>u.category.startsWith('llm_')).map(u=>u.key.split(':')[0])).size;
    if(requests>=s.agentSnapshot.maxRequests||this.failures>=2){await this.say("I'm having trouble completing that reliably. I can help arrange a callback from the team, or you can press zero for a person.");return;}
    const history:ChatCompletionMessageParam[]=buildContext(s,lead,await this.store.messages(s.id),await this.store.tools(s.id));
    const latest=(await this.store.messages(s.id)).filter(m=>m.role==='user').at(-1)?.text||'';
    const routing=routeModel(s.agentSnapshot,latest,this.failures,budget.exceeded&&budget.action==='economy');
    await this.store.event(s.id,'model_selected',{...routing,provider:s.agentSnapshot.llmProvider||'openai'});
    for(let round=0;round<3;round++) {
      if(g!==this.generation||controller.signal.aborted||this.closed)return;
      const usageSoFar=await this.store.usage(s.id);
      if(new Set(usageSoFar.filter(u=>u.category.startsWith('llm_')).map(u=>u.key.split(':')[0])).size>=s.agentSnapshot.maxRequests)break;
      const started=Date.now(),requestKey=crypto.randomUUID();let buffer='',spoken='',firstToken:number|null=null,assistant:Transcript|null=null;
      let needsDisclosure=s.memory.disclosureNeedsRetry===true;
      const successful=await this.store.tools(s.id);
      const booked=successful.some(t=>t.name==='book_appointment'&&t.status==='succeeded'),sent=successful.some(t=>['send_demo_link','send_followup'].includes(t.name)&&t.status==='succeeded');
      const emit=async(text:string,last:boolean)=>{
        if(!text||g!==this.generation||controller.signal.aborted||this.closed)return;
        const invalidBooking=/\b(?:booked|reserved|appointment (?:is |has been )?confirmed)\b/i.test(text)&&!booked;
        const invalidSend=/\b(?:sent|delivered|texted)\b/i.test(text)&&!sent;
        if(invalidBooking||invalidSend){text="I can't confirm that action yet. Let me help with the next step. ";await this.store.event(s.id,'response_validation_failed',{reason:invalidBooking?'unsupported_booking_claim':'unsupported_message_claim'});this.failures++;}
        if(needsDisclosure){text=`I'm the AI assistant for ${s.agentSnapshot.company}. `+text;needsDisclosure=false;const current=await this.session();await this.store.patchSession(s.id,{memory:{...current.memory,disclosureNeedsRetry:false}});}
        if(firstToken===null)firstToken=Date.now()-started;
        this.transport.text(text,last);spoken+=text;
        if(!assistant)assistant=await this.addMessage('assistant',spoken);
        else { assistant.text=spoken;assistant.generatedText=spoken;await this.store.patchMessage(assistant.id,{text:spoken,generatedText:spoken}); }
      };
      try {
        const result=await this.llm.complete({model:routing.model,config:s.agentSnapshot,messages:history,tools:llmTools(s.agentSnapshot.allowedTools),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(18000)]),cacheKey:s.agentSnapshot.optimizations.promptCacheKey?`voice-${s.agentId}`:undefined,
          onText:async text=>{if(g!==this.generation)return;buffer+=text;const split=buffer.search(/[.!?](?:\s|$)/);if(split>=0&&buffer.length>split+2){const sentence=buffer.slice(0,split+2);buffer=buffer.slice(split+2);await emit(sentence,false);}}});
        const usage=result.usage;
        const meta={provider:s.agentSnapshot.llmProvider||'openai',latencyMs:Date.now()-started,firstResponseMs:firstToken,escalated:routing.escalated,reason:routing.reason,finishReason:result.finishReason,usageIncomplete:!usage,requestId:result.requestId,firstTokenMs:result.firstTokenMs??null,retryCount:0,startedAt:new Date(started).toISOString(),endedAt:new Date().toISOString(),reasoningTokens:usage?.reasoning||0};
        for(const [category,count] of [['llm_input',Math.max(0,(usage?.input||0)-(usage?.cached||0))],['llm_cached_input',usage?.cached||0],['llm_output',usage?.output||0]] as const)
          await this.store.recordUsage(usageEvent(s.id,`${requestKey}:${category}`,category,String(count),'token',routing.model,meta));
        if(g!==this.generation||controller.signal.aborted)return;
        if(buffer)await emit(buffer,true);else if(spoken)this.transport.text(' ',true);
        if(assistant)await this.store.patchMessage((assistant as Transcript).id,{generatedText:result.text});
        await this.store.event(s.id,'turn_completed',{latencyMs:Date.now()-started,firstResponseMs:firstToken,validation:result.finishReason==='length'?'truncated':'completed'});
        if(!result.tools.length){if(result.finishReason==='length')this.failures++;else this.failures=Math.max(0,this.failures-1);return;}
        history.push({role:'assistant',content:result.text||null,tool_calls:result.tools.map(t=>({id:t.id,type:'function',function:{name:t.name,arguments:t.arguments}}))});
        for(const call of result.tools) {
          if(g!==this.generation||controller.signal.aborted)return;
          let args:unknown;try{args=JSON.parse(call.arguments);}catch{args=null;}
          const output=await this.tools.execute(s.id,call.name,args,controller.signal);
          if(!output.ok)this.failures++;
          history.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(output)});
          if(call.name==='end_call'&&output.ok){await this.finish('COMPLETED','tool_end');return;}
          if(call.name==='mark_do_not_call'&&output.ok){await this.say("You're on our do-not-call list. Goodbye.");await this.finish('OPTED_OUT','opt_out');return;}
          if(call.name==='request_human_transfer'&&output.ok){this.closed=true;this.cancel();return;}
        }
        s=await this.session();
      } catch (error) {
        const httpStatus=Number((error as {status?:number}).status)||null;
        await this.store.recordUsage(usageEvent(s.id,`${requestKey}:llm_input`,'llm_input','0','token',routing.model,{provider:s.agentSnapshot.llmProvider||'openai',usageIncomplete:true,canceled:controller.signal.aborted,latencyMs:Date.now()-started,httpStatus,startedAt:new Date(started).toISOString(),endedAt:new Date().toISOString(),retryCount:0}));
        if(g!==this.generation||controller.signal.aborted)return;
        this.failures++;await this.store.event(s.id,'llm_failure',{code:httpStatus===429?'rate_limited':'provider_unavailable',httpStatus});
        await this.say("I'm having trouble getting a response. You can press zero to request a person, or we can try your question again.");return;
      }
    }
    await this.say("I couldn't complete that reliably. Would you like a callback from the team?");
  }
  private async optOut(reason:string) {
    this.cancel();const result=await this.tools.execute(this.sessionId,'mark_do_not_call',{reason},new AbortController().signal);
    if(!result.ok){await this.say("I'm ending the call, but I couldn't confirm the do-not-call record. Please contact our team to confirm your request.");this.transport.end('service_unavailable');await this.finish('FAILED','opt_out_persistence_failed',false);return;}
    await this.say("You're on our do-not-call list. We won't contact you again. Goodbye.");
    // Ending via the Connect action returns a trusted farewell TwiML instead of cutting off queued speech.
    this.transport.end('opt_out');await this.finish('OPTED_OUT','opt_out',false);
  }
  private async human() {
    this.cancel();await this.say("I'll try to connect you with our team.");
    const result=await this.tools.execute(this.sessionId,'request_human_transfer',{reason:'Caller requested a human'},new AbortController().signal);
    if(!result.ok){await this.store.patchSession(this.sessionId,{state:'FOLLOW_UP',outcome:'Human requested'});await this.say("A person isn't available through this line right now. May I record that you would like a callback?");}
    else {this.closed=true;this.cancel();}
  }
  async tick(now=Date.now()) {
    if(this.closed||!this.started||this.finishing)return;
    const s=await this.session();if(s.endedAt){this.closed=true;this.cancel();this.transport.close();return;}
    const started=Date.parse(s.startedAt||s.createdAt),seconds=Math.max(0,Math.floor((now-started)/1000));
    await this.store.patchSession(s.id,{durationSeconds:seconds,relaySeconds:seconds});
    await this.store.recordUsage(usageEvent(s.id,'voice_duration',`twilio_${s.direction}`,String(seconds),'second',parsePhoneNumberFromString(s.phone)?.country||'UNKNOWN',{source:'gateway connected elapsed estimate'}));
    await this.store.recordUsage(usageEvent(s.id,'relay_duration','conversation_relay',String(seconds),'second','',{source:'gateway connected elapsed estimate'}));
    const warningAt=Math.max(0,s.agentSnapshot.maxDurationSeconds-30);
    if(seconds>=warningAt&&!s.memory.durationWarning&&!this.controller){await this.store.patchSession(s.id,{memory:{...s.memory,durationWarning:true}});await this.say("We're approaching this line's time limit. You can press zero for the team, or I can record your need for a callback.");}
    if(seconds>=s.agentSnapshot.maxDurationSeconds){this.transport.end('duration_limit');await this.finish('COMPLETED','duration_limit',false);return;}
    const settings=await this.store.settings();
    if(!this.controller&&now-this.lastActivity>settings.silenceSeconds*1000) {
      this.lastActivity=now;this.silencePrompts++;
      await this.store.event(s.id,'silence_prompt',{attempt:this.silencePrompts});
      if(this.silencePrompts>settings.maxSilencePrompts){this.transport.end('inactive');await this.finish('COMPLETED','inactive',false);}
      else await this.say('Are you still there? Take your time, or let me know how I can help.');
    }
  }
  async disconnect() {
    this.cancel();await this.queue.catch(()=>{});await this.pendingWrites;
    await this.store.event(this.sessionId,'websocket_disconnected',{code:'relay_closed'});
    const s=await this.session();
    const relayStarted=Date.parse(String(s.memory.relayStartedAt||s.startedAt||s.createdAt));
    const relaySeconds=Math.max(s.relaySeconds,Math.floor((Date.now()-relayStarted)/1000));
    await this.store.patchSession(s.id,{relaySeconds});
    await this.store.recordUsage(usageEvent(s.id,'relay_duration','conversation_relay',String(relaySeconds),'second'));
    if(s.startedAt){const seconds=Math.max(s.durationSeconds,Math.floor((Date.now()-Date.parse(s.startedAt))/1000));await this.store.patchSession(s.id,{durationSeconds:seconds});await this.store.recordUsage(usageEvent(s.id,'voice_duration',`twilio_${s.direction}`,String(seconds),'second',parsePhoneNumberFromString(s.phone)?.country||'UNKNOWN',{source:'gateway connected elapsed estimate'}));}
    if(s.state==='HUMAN_HANDOFF'){this.closed=true;return;}
    if(!s.endedAt)await this.finish(terminalStates.includes(s.state)?s.state:'COMPLETED','socket_disconnected',false);
  }
  async fail(code:string) {
    this.cancel();await this.store.event(this.sessionId,'error',{code});
    this.transport.end('service_unavailable');await this.finish('FAILED',code,false);
  }
  private async finish(state:State,reason:string,requestEnd=true) {
    if(this.finishing)return;this.finishing=true;this.cancel();
    const s=await this.session();await this.store.patchSession(s.id,{state,endedAt:s.endedAt||new Date().toISOString(),summary:s.summary||reason,outcome:s.outcome||'Unresolved'});
    await this.store.event(s.id,'session_ended',{reason});if(requestEnd)this.transport.end(reason);this.closed=true;
  }
  async idle(){await this.queue;await this.pendingWrites;this.controller=null;}
}
