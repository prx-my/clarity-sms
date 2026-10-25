import { createHash } from 'node:crypto';
import { z } from 'zod';

export const categories = ['VOICE','MESSAGING','AI_AGENT','LLM','STT','TTS','INFRASTRUCTURE','BILLING','TOOL_EXECUTION','SYSTEM_EVENT'] as const;
const decimal = z.string().regex(/^\d{1,15}(\.\d{1,12})?$/);
export const eventSchema = z.object({
  key:z.string().min(1).max(500), type:z.string().regex(/^[a-z][a-z0-9_.]+$/).max(120), category:z.enum(categories),
  provider:z.string().min(1).max(80), accountId:z.string().max(100).nullable().default(null),
  resourceId:z.string().min(1).max(250), interactionId:z.string().max(250).nullable().default(null),
  parentId:z.string().max(250).nullable().default(null), callSid:z.string().max(40).nullable().default(null), messageSid:z.string().max(40).nullable().default(null),
  sessionId:z.string().max(100).nullable().default(null), agentId:z.string().max(100).nullable().default(null), campaignId:z.string().max(100).nullable().default(null),
  contactId:z.string().max(100).nullable().default(null), correlationId:z.string().max(150).nullable().default(null), traceId:z.string().max(150).nullable().default(null),
  occurredAt:z.iso.datetime(), status:z.string().max(80).nullable().default(null), errorCode:z.string().max(100).nullable().default(null),
  data:z.record(z.string(),z.unknown()).default({}), testData:z.boolean().default(false),
}).strict();
export type Telemetry = z.infer<typeof eventSchema>;
export type EventInput = z.input<typeof eventSchema>;
// Only measured operational metadata is admitted. Bodies, prompts, credentials, raw
// tool arguments, summaries, media URLs and provider error descriptions are excluded.
const allowed = new Set(['from','to','direction','statusRank','durationSeconds','answeredAt','endedAt','startedAt','segments','estimatedSegments','encoding','mediaCount','messagingServiceSid','service','model','quantity','unit','usageIncomplete','bundled','source','price','priceConvention','currency','billingReference','latencyMs','durationMs','firstTokenMs','firstResponseMs','requestId','retryCount','reasoningTokens','name','outcome','interrupted','providerStatus','recordingSid','recordingStatus','qualityWarning','httpStatus','code','sourceTimestampAvailable','country']);
export function sanitize(data:Record<string,unknown>) {
  return Object.fromEntries(Object.entries(data).filter(([k,v])=>allowed.has(k)&&(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||typeof v==='string')).map(([k,v])=>[k,typeof v==='string'?v.slice(0,250):v]));
}
export function normalize(input:EventInput):Telemetry { const timestamp=new Date(input.occurredAt);if(!Number.isFinite(timestamp.getTime()))throw new Error('Invalid event timestamp');const e=eventSchema.parse({...input,occurredAt:timestamp.toISOString()}); return {...e,data:sanitize(e.data)}; }
export function hash(value:unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export const callRanks:Record<string,number>={queued:0,initiated:1,ringing:2,'in-progress':3,completed:5,busy:5,'no-answer':5,failed:5,canceled:5};
export const messageRanks:Record<string,number>={scheduled:0,accepted:1,queued:2,sending:3,sent:4,failed:5,undelivered:5,canceled:5,delivered:6,receiving:2,received:6,read:7};
export function nonnegative(value:unknown):number|null { if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)&&n>=0?n:null; }
export function segments(body:string) {
  const basic = new Set(Array.from('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'));
  const extension=new Set(Array.from('^{}\\[~]|€\f')); let units=0,unicode=false;
  for(const c of body){if(basic.has(c))units++;else if(extension.has(c))units+=2;else {unicode=true;break;}}
  if(unicode)units=body.length;const single=unicode?70:160,multi=unicode?67:153;
  return {encoding:unicode?'UCS-2':'GSM-7',segments:units===0?0:units<=single?1:Math.ceil(units/multi),estimated:true};
}
export function voiceEvent(p:Record<string,string>, extra:Partial<EventInput>={}):Telemetry {
  if(!/^CA[0-9a-f]{32}$/i.test(p.CallSid||'')||!(p.CallStatus in callRanks))throw new Error('Invalid call event');
  const t=p.Timestamp&&Number.isFinite(Date.parse(p.Timestamp))?new Date(p.Timestamp).toISOString():new Date().toISOString();
  const label=p.CallStatus==='in-progress'?'answered':p.CallStatus.replaceAll('-','_');
  return normalize({key:`twilio:voice:${p.AccountSid}:${p.CallSid}:${p.CallStatus}:${p.SequenceNumber||''}:${p.CallDuration||''}`,type:`voice.call.${label}`,category:'VOICE',provider:'twilio',accountId:p.AccountSid||null,
    resourceId:p.CallSid,callSid:p.CallSid,parentId:p.ParentCallSid||null,interactionId:p.ParentCallSid||p.CallSid,occurredAt:t,status:p.CallStatus,errorCode:p.ErrorCode||null,
    data:{from:p.From,to:p.To,direction:p.Direction,statusRank:callRanks[p.CallStatus],durationSeconds:nonnegative(p.CallDuration),sourceTimestampAvailable:!!p.Timestamp,...(p.CallStatus==='in-progress'?{answeredAt:t}:{}),...(callRanks[p.CallStatus]===5?{endedAt:t}:{})},...extra});
}
export function messageEvent(p:Record<string,string>,extra:Partial<EventInput>={}):Telemetry {
  const sid=p.MessageSid||p.SmsSid,status=p.MessageStatus||p.SmsStatus||'received';
  if(!/^(SM|MM)[0-9a-f]{32}$/i.test(sid||'')||!(status in messageRanks))throw new Error('Invalid message event');
  return normalize({key:`twilio:message:${p.AccountSid}:${sid}:${status}:${p.NumSegments||''}:${p.ErrorCode||''}`,type:`messaging.${Number(p.NumMedia)>0?'mms':'sms'}.${status}`,category:'MESSAGING',provider:'twilio',accountId:p.AccountSid||null,resourceId:sid,messageSid:sid,interactionId:sid,
    occurredAt:new Date().toISOString(),status,errorCode:p.ErrorCode||null,data:{from:p.From,to:p.To,direction:status==='received'||status==='receiving'?'inbound':'outbound',statusRank:messageRanks[status],segments:nonnegative(p.NumSegments),mediaCount:nonnegative(p.NumMedia),messagingServiceSid:p.MessagingServiceSid},...extra});
}
export const rateSchema=z.object({provider:z.string().min(1).max(80),service:z.string().min(1).max(80),model:z.string().max(150).default(''),currency:z.string().regex(/^[A-Z]{3}$/),unit:z.enum(['second','minute','segment','message','token','character','request']),amount:decimal,effectiveAt:z.iso.datetime(),source:z.url(),increment:z.number().int().min(1).max(3600).default(1),bundled:z.boolean().default(false)}).strict();
export const ruleSchema=z.object({name:z.string().min(1).max(100),metric:z.enum(['spend','failure_rate','no_answer_rate','tokens','latency_ms','duration_seconds','segments','volume','tool_failures','websocket_disconnects','webhook_failures','reconciliation_failures','queue_backlog','llm_failure_rate','llm_rate_limits']),threshold:decimal,windowMinutes:z.number().int().min(1).max(44640),minSamples:z.number().int().min(1).max(100000).default(1),severity:z.enum(['warning','critical']).default('warning'),cooldownMinutes:z.number().int().min(1).max(10080).default(30),scope:z.enum(['workspace','agent','campaign','provider']).default('workspace'),scopeId:z.string().max(150).default(''),currency:z.string().regex(/^[A-Z]{3}$/).default('USD'),enabled:z.boolean().default(true)}).strict();
export const budgetSchema=z.object({name:z.string().min(1).max(100),scope:z.enum(['workspace','agent','campaign','provider']),scopeId:z.string().max(150).default(''),period:z.enum(['day','month']),currency:z.string().regex(/^[A-Z]{3}$/),limit:decimal,warningPercent:z.number().int().min(1).max(100).default(80),criticalPercent:z.number().int().min(1).max(100).default(100)}).strict().refine(v=>v.criticalPercent>=v.warningPercent,'Critical threshold must follow warning');

export function webhookMetadata(params:Record<string,string>){
  const fields=new Set(['AccountSid','CallSid','ParentCallSid','MessageSid','MessageStatus','SmsStatus','CallStatus','ErrorCode','SequenceNumber','NumSegments','NumMedia','MessagingServiceSid']);
  return Object.fromEntries(Object.entries(params).filter(([k])=>fields.has(k)).map(([k,v])=>[k,v.slice(0,150)]));
}
