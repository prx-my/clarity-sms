import { validateWebhook } from '@/lib/twilio';
import { MonitoringStore } from '@/lib/monitoring/store';
import { voiceEvent } from '@/lib/monitoring/model';
export const runtime='nodejs';
export async function POST(request:Request){
  const params=Object.fromEntries(await request.formData()) as Record<string,string>;
  if(!validateWebhook(request,params)||params.AccountSid!==process.env.TWILIO_ACCOUNT_SID)return new Response('Invalid signature',{status:403});
  let event;try{event=voiceEvent(params);}catch{return new Response('Invalid event',{status:400});}
  try{await new MonitoringStore().ingest(event);return new Response('<Response/>',{headers:{'Content-Type':'text/xml'}});}
  catch{console.error('Monitoring voice callback persistence failed');return new Response('Retry callback',{status:503});}
}
