import dotenv from 'dotenv';
dotenv.config({path:'.env.local',quiet:true});dotenv.config({quiet:true});
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';
import { PostgresStore } from '../src/lib/ai/store';
import { defaultAgent } from '../src/lib/ai/config';
import { normalizePhone } from '../src/lib/phone';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { voiceClient } from '../src/lib/ai/providers';

async function main(){
  if(!process.argv.includes('--apply'))throw new Error('Use --apply after reviewing the additive migration and consent record');
  const input=JSON.parse(await readFile('.ai-local/setup-input.json','utf8')) as {phone:string;consentEvidence:string;timezone:string};
  const phone=normalizePhone(input.phone);if(!phone||!input.consentEvidence||!input.timezone)throw new Error('Explicit consent, test phone and timezone are required');
  const sql=neon(process.env.DATABASE_URL!);
  const rows=await sql`select table_name from information_schema.tables where table_schema='public'`;
  const existing=new Set(rows.map(r=>r.table_name));
  const expected=['ai_agents','ai_call_events','ai_lead_memory','ai_conversation_messages','ai_lead_qualifications','ai_rate_cards','ai_call_sessions','ai_settings','ai_tool_executions','ai_call_usage'];
  const found=expected.filter(t=>existing.has(t));
  if(found.length&&found.length!==expected.length)throw new Error('Partial AI schema requires review; no automatic repair attempted');
  let migrationApplied=false;
  if(!found.length){
    if(!['contacts','conversations','messages','message_events','webhook_logs'].every(t=>existing.has(t)))throw new Error('Existing Clarity schema required');
    const migration=await readFile('drizzle/0001_yellow_bromley.sql','utf8');
    await sql.transaction(migration.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean).map(statement=>sql.query(statement,[])));
    migrationApplied=true;
  }
  const store=new PostgresStore();const agents=await store.agents();
  const name='Schrader — Consented owner test';
  const existingAgent=agents.find(a=>a.config.name===name);
  const config={...(existingAgent?.config||defaultAgent()),name,
    description:'Dedicated profile for the owner-requested, explicitly consented setup test.',
    purpose:'Conduct the owner-requested AI demo call. Disclose AI identity, discuss website needs, and accurately save qualification evidence. Do not send messages or invent bookings.',
    instructions:'This is an explicitly requested owner test call. Explain briefly that this is the requested demonstration. Ask about website needs, save useful caller-provided facts and qualification through the tools, and keep replies concise. Do not claim that a calendar is connected unless availability succeeds.',
    greeting:"Hello! This is the AI assistant for Schrader Web Solutions, calling for the demonstration you requested. Is now still a good time to try a short conversation about a website?",
    timezone:input.timezone,operatingHours:{start:0,end:24,days:[0,1,2,3,4,5,6]},maxDurationSeconds:180,
    llmProvider:process.env.AI_LLM_PROVIDER==='groq'?'groq' as const:'openai' as const,
    model:process.env.AI_LLM_MODEL||process.env.OPENAI_MODEL||'gpt-4.1-mini',reasoningEffort:process.env.AI_LLM_PROVIDER==='groq'?'low' as const:null,
    maxOutputTokens:process.env.AI_LLM_PROVIDER==='groq'?768:240,enabled:false,followupEnabled:false,maxCostUsd:'2.00',maxRequests:20,
  };
  const agent=await store.saveAgent(existingAgent?.id||crypto.randomUUID(),config);
  const lead=await store.leadByPhone(phone);if(lead.optedOut)throw new Error('Test contact is suppressed; setup will not clear an opt-out');
  lead.consentAt=new Date().toISOString();lead.consentEvidence=input.consentEvidence;lead.timezone=input.timezone;await store.saveLead(lead);
  const settings=await store.settings();await store.saveSettings({...settings,outboundPaused:true});
  const country=parsePhoneNumberFromString(phone)?.country;if(!country)throw new Error('Destination country unavailable');
  const pricing=await voiceClient().pricing.v1.voice.countries(country).fetch();
  if(pricing.priceUnit!=='USD')throw new Error('USD pricing required for this rate-card import');
  const groups=pricing.outboundPrefixPrices.map(g=>({prefixes:g.prefixes||[],currentPrice:String(g.currentPrice??''),friendlyName:g.friendlyName||'Country outbound'}));
  const matching=groups.flatMap(g=>g.prefixes.filter(prefix=>phone.slice(1).startsWith(prefix)).map(prefix=>({group:g,length:prefix.length}))).sort((a,b)=>b.length-a.length);
  if(!matching[0])throw new Error('No verified Twilio price for the test destination');
  const now=new Date().toISOString();
  const priceCards=[
    {provider:'Twilio',category:'twilio_outbound',model:country,unit:'minute',usdPerUnit:matching[0].group.currentPrice,source:`https://pricing.twilio.com/v1/Voice/Countries/${country}`,increment:60},
    {provider:'Twilio',category:'conversation_relay',model:'',unit:'minute',usdPerUnit:'0.07',source:'https://www.twilio.com/en-us/products/conversational-ai/pricing',increment:60},
    ...(config.model==='gpt-4.1-mini'?[
      {provider:'OpenAI',category:'llm_input',model:config.model,unit:'token',usdPerUnit:'0.0000004',source:'https://developers.openai.com/api/docs/models/gpt-4.1-mini',increment:1},
      {provider:'OpenAI',category:'llm_cached_input',model:config.model,unit:'token',usdPerUnit:'0.0000001',source:'https://developers.openai.com/api/docs/models/gpt-4.1-mini',increment:1},
      {provider:'OpenAI',category:'llm_output',model:config.model,unit:'token',usdPerUnit:'0.0000016',source:'https://developers.openai.com/api/docs/models/gpt-4.1-mini',increment:1},
    ]:[]),
    ...(config.llmProvider==='groq'&&config.model==='openai/gpt-oss-20b'?[
      {provider:'Groq',category:'llm_input',model:config.model,unit:'token',usdPerUnit:'0.000000075',source:'https://console.groq.com/docs/models',increment:1},
      {provider:'Groq',category:'llm_cached_input',model:config.model,unit:'token',usdPerUnit:'0.0000000375',source:'https://console.groq.com/docs/prompt-caching',increment:1},
      {provider:'Groq',category:'llm_output',model:config.model,unit:'token',usdPerUnit:'0.0000003',source:'https://console.groq.com/docs/models',increment:1},
    ]:[]),
  ];
  const current=await store.rates();let added=0;
  for(const card of priceCards){if(current.some(r=>r.category===card.category&&r.model===card.model&&r.usdPerUnit===card.usdPerUnit))continue;await store.addRate({...card,id:crypto.randomUUID(),effectiveAt:now,bundled:false});added++;}
  await mkdir('.ai-local',{recursive:true});
  await writeFile('.ai-local/setup-result.json',JSON.stringify({agentId:agent.id,contactId:lead.id,phone,country,consentAt:lead.consentAt,migrationApplied,ratesAdded:added,voiceRateUsdPerMinute:matching[0].group.currentPrice,voiceRateDestination:matching[0].group.friendlyName,configuredAt:now},null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({migrationApplied,aiTables:expected.length,testProfileCreated:true,consentRecorded:true,ratesAdded:added,country,voiceRateUsdPerMinute:matching[0].group.currentPrice,callingEnabled:false}));
}
void main().catch(error=>{console.error('AI setup failed',{kind:error?.name||'Error',code:error?.code||null});process.exitCode=1;});
