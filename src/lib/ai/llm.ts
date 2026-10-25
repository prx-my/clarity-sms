import { llmClient } from './llm-connection';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { AgentConfig } from './config';
export type ToolCall={id:string;name:string;arguments:string};
export type LlmUsage={input:number;cached:number;output:number;reasoning:number};
export type LlmResult={text:string;tools:ToolCall[];usage:LlmUsage|null;requestId:string;finishReason:string|null;firstTokenMs?:number|null;completionId?:string|null};
export interface LlmProvider {
  complete(options:{model:string;config:AgentConfig;messages:ChatCompletionMessageParam[];tools:ChatCompletionTool[];signal:AbortSignal;onText:(text:string)=>Promise<void>;cacheKey?:string}):Promise<LlmResult>;
}
export class OpenAiLlm implements LlmProvider {
  async complete(o:Parameters<LlmProvider['complete']>[0]):Promise<LlmResult> {
    const provider=o.config.llmProvider||'openai',api=llmClient(provider);
    const began=Date.now();
    const {data:stream,request_id:providerRequestId}=await api.chat.completions.create({model:o.model,messages:o.messages,tools:o.tools.length?o.tools:undefined,parallel_tool_calls:false,stream:true,stream_options:{include_usage:true},max_completion_tokens:o.config.maxOutputTokens,
      ...(provider==='openai'?{store:false,...(o.cacheKey?{prompt_cache_key:o.cacheKey}:{})}:{}),
      ...(o.config.reasoningEffort?{reasoning_effort:o.config.reasoningEffort}:{}),...(o.config.temperature===null?{}:{temperature:o.config.temperature})},{signal:o.signal}).withResponse();
    const calls=new Map<number,ToolCall>(),requestId=providerRequestId||'';let text='',usage:LlmUsage|null=null,finishReason:string|null=null,firstTokenMs:number|null=null,completionId:string|null=null;
    for await(const chunk of stream) {
      completionId=chunk.id;
      const providerUsage=chunk.usage||(chunk as typeof chunk&{x_groq?:{usage?:typeof chunk.usage}}).x_groq?.usage;
      if(providerUsage)usage={input:providerUsage.prompt_tokens,cached:providerUsage.prompt_tokens_details?.cached_tokens||0,output:providerUsage.completion_tokens,reasoning:providerUsage.completion_tokens_details?.reasoning_tokens||0};
      const choice=chunk.choices[0];if(!choice)continue;
      if(choice.finish_reason)finishReason=choice.finish_reason;
      if(choice.delta.content){if(firstTokenMs===null)firstTokenMs=Date.now()-began;text+=choice.delta.content;await o.onText(choice.delta.content);}
      for(const delta of choice.delta.tool_calls||[]) {
        const c=calls.get(delta.index)||{id:'',name:'',arguments:''};
        if(delta.id)c.id=delta.id;if(delta.function?.name)c.name+=delta.function.name;if(delta.function?.arguments)c.arguments+=delta.function.arguments;calls.set(delta.index,c);
      }
    }
    return {text,tools:[...calls.values()],usage,requestId,finishReason,firstTokenMs,completionId};
  }
}
