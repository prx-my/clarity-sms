import { createHmac, timingSafeEqual } from 'node:crypto';
import twilio from 'twilio';
import { publicAppUrl } from '@/lib/twilio';
import type { Store } from './store';
import { usageEvent } from './store';
import { canTransition, terminalStates } from './policy';
import type { Session } from './types';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export const xml=(value:string)=>new Response(value,{headers:{'Content-Type':'text/xml; charset=utf-8','Cache-Control':'no-store'}});
export function validateAiWebhook(request:Request,params:Record<string,string>) {
  const token=process.env.TWILIO_AUTH_TOKEN,signature=request.headers.get('x-twilio-signature');
  if(!token||!signature||params.AccountSid!==process.env.TWILIO_ACCOUNT_SID)return false;
  const path=new URL(request.url);return twilio.validateRequest(token,signature,`${publicAppUrl()}${path.pathname}${path.search}`,params);
}
function secret(){const value=process.env.AI_GATEWAY_SECRET;if(!value||value.length<32)throw new Error('AI_GATEWAY_SECRET must be at least 32 characters');return value;}
export function ticket(sessionId:string,callSid:string,expires=Math.floor(Date.now()/1000)+180) {
  const payload=`${sessionId}.${callSid}.${expires}`;return `${payload}.${createHmac('sha256',secret()).update(payload).digest('hex')}`;
}
export function verifyTicket(value:string,sessionId:string,callSid:string) {
  const parts=value.split('.');if(parts.length!==4||parts[0]!==sessionId||parts[1]!==callSid||Number(parts[2])<Date.now()/1000)return false;
  const expected=ticket(sessionId,callSid,Number(parts[2]));return expected.length===value.length&&timingSafeEqual(Buffer.from(expected),Buffer.from(value));
}
export function relayTwiml(session:Session) {
  if(!session.callSid)throw new Error('Call SID is required');
  const c=session.agentSnapshot,response=new twilio.twiml.VoiceResponse();
  const url=new URL(process.env.AI_WEBSOCKET_PUBLIC_URL||'');if(url.protocol!=='wss:')throw new Error('AI WebSocket URL must use WSS');
  const connect=response.connect({action:`${publicAppUrl()}/api/twilio/ai/action?session=${session.id}`,method:'POST'});
  const relay=connect.conversationRelay({url:url.toString(),ttsProvider:c.ttsProvider,voice:c.voice,transcriptionProvider:c.transcriptionProvider,speechModel:c.speechModel,language:c.language,interruptible:'any',dtmfDetection:true});
  relay.parameter({name:'sessionId',value:session.id});relay.parameter({name:'ticket',value:ticket(session.id,session.callSid)});
  return response.toString();
}
export function fallbackTwiml(reason='service_unavailable') {
  const r=new twilio.twiml.VoiceResponse();
  if(reason==='opt_out')r.say("You're on our do-not-call list. We won't contact you again. Goodbye.");
  else if(reason==='duration_limit')r.say("This demo line has reached its time limit. Please call our team again if you need more help. Thank you.");
  else if(reason==='inactive'||reason==='completed')r.say('Thank you for calling. Goodbye.');
  else r.say("The AI assistant isn't available right now. Please try again later. Goodbye.");
  r.hangup();return r.toString();
}
export function relayEndReason(params:Record<string,string>){let reason=params.SessionStatus==='completed'||params.CallStatus==='completed'?'completed':'service_unavailable';try{reason=JSON.parse(params.HandoffData||'{}').reason||reason;}catch{}return reason;}
const ranks:Record<string,number>={queued:0,initiated:1,ringing:2,'in-progress':3,completed:5,failed:5,busy:5,'no-answer':5,canceled:5};
export async function applyStatus(store:Store,sessionId:string,p:Record<string,string>) {
  const s=await store.session(sessionId);if(!s)return;
  if(p.AccountSid!==process.env.TWILIO_ACCOUNT_SID||!/^CA[a-fA-F0-9]{32}$/.test(p.CallSid||''))throw new Error('Invalid account or call');
  if(!await store.bindCall(s.id,p.CallSid))throw new Error('Call SID mismatch');
  const status=p.CallStatus;
  if(!(status in ranks))return;
  await store.event(s.id,'twilio_status',{status,sequence:p.SequenceNumber||null});
  if((ranks[status]??0)<(ranks[s.connectionStatus]??0))return;
  const terminal=ranks[status]===5;
  let state=s.state;
  if(!terminalStates.includes(state)&&terminal)state=({failed:'FAILED',busy:'BUSY','no-answer':'NO_ANSWER',canceled:'CANCELED',completed:'COMPLETED'} as const)[status as 'completed'];
  const seconds=Math.max(s.durationSeconds,Math.max(0,Math.min(86400,Number(p.CallDuration)||0)));
  await store.advanceStatus(s.id,status,{...(canTransition(s.state,state)?{state}:{}),...(status==='in-progress'&&!s.startedAt?{startedAt:new Date().toISOString()}:{}),...(terminal?{endedAt:s.endedAt||new Date().toISOString(),durationSeconds:seconds}: {})});
  if(terminal) {
    const country=parsePhoneNumberFromString(s.phone)?.country||'UNKNOWN';
    await store.recordUsage(usageEvent(s.id,'voice_duration',`twilio_${s.direction}`,String(seconds),'second',country,{source:'Twilio signed CallDuration'}));
  }
}
