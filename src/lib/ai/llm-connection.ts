import OpenAI from 'openai';
export type LlmProviderName='openai'|'groq';
export function defaultLlmProvider():LlmProviderName{return process.env.AI_LLM_PROVIDER==='groq'?'groq':'openai';}
export function llmConnection(provider:LlmProviderName=defaultLlmProvider()){
  return provider==='groq'?{provider,apiKeyEnv:'GROQ_API_KEY',apiKey:process.env.GROQ_API_KEY,baseURL:'https://api.groq.com/openai/v1'}:{provider,apiKeyEnv:'OPENAI_API_KEY',apiKey:process.env.OPENAI_API_KEY,baseURL:'https://api.openai.com/v1'};
}
export function llmClient(provider:LlmProviderName=defaultLlmProvider(),timeout=18000){const c=llmConnection(provider);return new OpenAI({apiKey:c.apiKey,baseURL:c.baseURL,maxRetries:0,timeout});}
