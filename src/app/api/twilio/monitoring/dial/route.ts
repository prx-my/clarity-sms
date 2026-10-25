import { validateWebhook } from '@/lib/twilio';
import { collect } from '@/lib/monitoring/store';
import { voiceEvent } from '@/lib/monitoring/model';
export const runtime='nodejs';
export async function POST(request:Request){
  const p=Object.fromEntries(await request.formData()) as Record<string,string>;
  if(!validateWebhook(request,p)||p.AccountSid!==process.env.TWILIO_ACCOUNT_SID)return new Response('Invalid signature',{status:403});
  // An action callback is on the call's control path: never return monitoring
  // errors to the caller. Child status callbacks supply durable retry semantics.
  try {
  if(p.DialCallSid)await collect(voiceEvent({...p,CallSid:p.DialCallSid,ParentCallSid:p.CallSid,CallStatus:p.DialCallStatus,CallDuration:p.DialCallDuration||'',Direction:'outbound-dial'}));
  if(p.CallSid)await collect(voiceEvent({...p,CallStatus:'completed',CallDuration:''}));
  }catch{console.error('Monitoring dial action could not be recorded');}
  return new Response('<Response/>',{headers:{'Content-Type':'text/xml'}});
}
