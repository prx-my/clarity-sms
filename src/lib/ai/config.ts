import { z } from 'zod';

export const toolNames = ['lookup_lead', 'update_lead', 'save_qualification', 'check_calendar_availability', 'book_appointment', 'send_demo_link', 'send_followup', 'request_human_transfer', 'mark_do_not_call', 'end_call'] as const;
export const outcomes = ['Interested', 'Needs follow-up', 'Not interested', 'Meeting requested', 'Meeting booked', 'Wrong number', 'Voicemail', 'Human requested', 'Opted out', 'Unqualified', 'Unresolved'] as const;
export const agentSchema = z.object({
  name: z.string().trim().min(1).max(100), description: z.string().max(1000).default(''),
  company: z.string().trim().min(1).max(150), purpose: z.string().max(1000),
  instructions: z.string().max(8000).default(''), greeting: z.string().min(1).max(600),
  allowedTools: z.array(z.enum(toolNames)).default([...toolNames]),
  model: z.string().min(1).max(100), escalationModel: z.string().max(100).default(''),
  llmProvider:z.enum(['openai','groq']).default('openai'),reasoningEffort:z.enum(['none','low','medium','high']).nullable().default(null),
  temperature: z.number().min(0).max(2).nullable().default(null), maxOutputTokens: z.number().int().min(128).max(1500).default(240),
  voiceTier: z.enum(['economy', 'standard', 'premium']).default('economy'),
  ttsProvider: z.enum(['Google', 'Amazon', 'ElevenLabs']).default('Google'), voice: z.string().min(1).max(150).default('en-US-Journey-F'),
  transcriptionProvider: z.enum(['Google', 'Deepgram']).default('Google'), speechModel: z.string().max(100).default('telephony'),
  language: z.literal('en-US').default('en-US'), speakingStyle: z.string().max(1000).default('Professional, warm, concise; ask one question at a time.'),
  qualificationQuestions: z.array(z.string().max(400)).max(20).default(['What would you like your website to help with?', 'What timeline do you have in mind?']),
  businessInformation: z.string().max(8000).default('Website development, website redesign, and digital marketing inquiries. Pricing requires a conversation with the team.'),
  knowledge: z.array(z.object({ title: z.string().max(150), text: z.string().max(4000) })).max(50).default([]),
  timezone: z.string().refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Use a valid IANA timezone').default('America/New_York'),
  operatingHours: z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(1).max(24), days: z.array(z.number().int().min(0).max(6)).min(1) }).default({ start: 9, end: 18, days: [1, 2, 3, 4, 5] }),
  escalationRules: z.string().max(2000).default('Offer a human for missing information, explicit requests, or repeated failures.'),
  maxDurationSeconds: z.number().int().min(60).max(3600).default(600),
  transferNumber: z.string().max(30).default(''), demoUrl: z.union([z.literal(''), z.url().refine(v => v.startsWith('https://'), 'Use HTTPS')]).default(''),
  followupText: z.string().max(1000).default('Thank you for speaking with us. Our team will follow up about your website inquiry.'),
  followupEnabled: z.boolean().default(false), enabled: z.boolean().default(false),
  maxCostUsd: z.string().regex(/^\d+(\.\d{1,6})?$/).default('2.00'),
  maxCostPerMinuteUsd: z.string().regex(/^\d+(\.\d{1,6})?$/).default('0.25'),
  maxRequests: z.number().int().min(1).max(100).default(30), maxTools: z.number().int().min(1).max(100).default(20),
  tokenWarning: z.number().int().min(100).max(1000000).default(20000),
  optimizations: z.object({ adaptiveRouting: z.boolean(), compactContext: z.boolean(), conciseResponses: z.boolean(), promptCacheKey: z.boolean(), toolCache: z.boolean() }).default({ adaptiveRouting: false, compactContext: true, conciseResponses: true, promptCacheKey: true, toolCache: true }),
}).strict().refine(v => v.operatingHours.start < v.operatingHours.end, 'Operating hours must end after they start');
export type AgentConfig = z.infer<typeof agentSchema>;
export type Agent = { id: string; config: AgentConfig; updatedAt: string };

export function defaultAgent(): AgentConfig {
  return agentSchema.parse({
    name: 'Schrader Web Solutions — AI Sales Assistant', company: 'Schrader Web Solutions',
    description: 'Website development and redesign sales inquiries', purpose: 'Help inbound and consented demo callers, qualify their needs and arrange follow-up.',
    greeting: "Hi, thanks for calling Schrader Web Solutions. I'm the AI assistant. Are you looking for help with a new website or an existing one?",
    llmProvider:process.env.AI_LLM_PROVIDER==='groq'?'groq':'openai',
    model:process.env.AI_LLM_MODEL||(process.env.AI_LLM_PROVIDER==='groq'?'openai/gpt-oss-20b':process.env.OPENAI_MODEL||'gpt-4.1-mini'),transferNumber: process.env.AI_HUMAN_TRANSFER_NUMBER || '',
  });
}

export const workspaceSchema = z.object({
  dailyBudgetUsd: z.string().regex(/^\d+(\.\d{1,6})?$/).default('5.00'), monthlyBudgetUsd: z.string().regex(/^\d+(\.\d{1,6})?$/).default('25.00'),
  budgetAction: z.enum(['warn', 'notify', 'economy', 'block_outbound']).default('block_outbound'),
  outboundPaused: z.boolean().default(false),
  inboundMode: z.enum(['normal', 'allowlist', 'always']).default('normal'), inboundAgentId: z.string().default(''),
  previousVoiceUrl: z.string().default(''), previousVoiceMethod: z.enum(['GET', 'POST']).default('POST'),
  previousVoiceApplicationSid: z.string().default(''), previousResolvedVoiceUrl: z.string().default(''),
  phoneNumberSid: z.string().default(''), routingApplied: z.boolean().default(false),
  retentionDays: z.number().int().min(1).max(3650).default(30),
  silenceSeconds: z.number().int().min(15).max(180).default(40), maxSilencePrompts: z.number().int().min(1).max(3).default(2),
  exchangeRate: z.object({ usdInr: z.string().regex(/^\d+(\.\d{1,6})?$/), source: z.url(), asOf: z.iso.datetime() }).nullable().default(null),
  experiment: z.object({ enabled: z.boolean(), name: z.string().max(100), baselineAgentId: z.string(), optimizedAgentId: z.string() }).default({ enabled: false, name: '', baselineAgentId: '', optimizedAgentId: '' }),
}).strict();
export type WorkspaceConfig = z.infer<typeof workspaceSchema>;

export function aiEnabled() { return process.env.AI_VOICE_ENABLED === '1' && process.env.DEMO_MODE !== '1'; }
export function allowlisted(phone: string) { return (process.env.AI_DEMO_ALLOWED_NUMBERS || '').split(',').map(p => p.trim()).includes(phone); }
export function requiredConfiguration(provider:'openai'|'groq'=process.env.AI_LLM_PROVIDER==='groq'?'groq':'openai') {
  const missing=[provider==='groq'?'GROQ_API_KEY':'OPENAI_API_KEY', 'DATABASE_URL', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'APP_URL', 'AI_WEBSOCKET_PUBLIC_URL', 'AI_GATEWAY_SECRET'].filter(k => !process.env[k]);
  if(process.env.AI_GATEWAY_SECRET&&process.env.AI_GATEWAY_SECRET.length<32)missing.push('AI_GATEWAY_SECRET (at least 32 characters)');
  for(const [key,protocol] of [['APP_URL','https:'],['AI_WEBSOCKET_PUBLIC_URL','wss:']] as const){if(process.env[key]){try{if(new URL(process.env[key]!).protocol!==protocol)missing.push(`${key} (${protocol} required for live AI)`);}catch{missing.push(`${key} (valid public URL required)`);}}}
  return missing;
}
export function disclosure(config: AgentConfig) {
  return `I'm the AI assistant for ${config.company}. ` + config.greeting;
}
