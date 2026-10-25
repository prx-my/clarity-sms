import twilio from 'twilio';
export function billingClient(){if(!process.env.TWILIO_ACCOUNT_SID||!process.env.TWILIO_AUTH_TOKEN)throw new Error('Twilio credentials unavailable');return twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN,{timeout:10000,autoRetry:false});}
import { hash, voiceEvent, messageEvent, type EventInput } from './model';
import type { CallInstance } from 'twilio/lib/rest/api/v2010/account/call';
import type { MessageInstance } from 'twilio/lib/rest/api/v2010/account/message';
export function callRecord(c:CallInstance):EventInput {
  const e=voiceEvent({AccountSid:c.accountSid,CallSid:c.sid,ParentCallSid:c.parentCallSid||'',CallStatus:c.status,CallDuration:c.duration||'',From:c.from,To:c.to,Direction:c.direction,Timestamp:(c.endTime||c.dateUpdated||c.dateCreated||new Date()).toISOString()});
  return {...e,key:`twilio:call-record:${c.sid}:${hash([c.status,c.duration,c.price,c.priceUnit,c.parentCallSid])}`,type:'voice.call.recovered',data:{...e.data,startedAt:c.dateCreated?.toISOString(),endedAt:c.endTime?.toISOString(),price:c.price,currency:c.priceUnit?.toUpperCase(),billingReference:c.sid,source:'Twilio Call resource'}};
}
export function messageRecord(m:MessageInstance,extra:Partial<EventInput>={}):EventInput {
  const e=messageEvent({AccountSid:m.accountSid,MessageSid:m.sid,MessageStatus:m.status,From:m.from,To:m.to,NumSegments:m.numSegments,NumMedia:m.numMedia,MessagingServiceSid:m.messagingServiceSid||'',ErrorCode:m.errorCode?String(m.errorCode):''});
  return {...e,key:`twilio:message-record:${m.sid}:${hash([m.status,m.numSegments,m.price,m.priceUnit,m.errorCode])}`,type:'messaging.message.recovered',occurredAt:(m.dateUpdated||m.dateCreated||new Date()).toISOString(),data:{...e.data,direction:m.direction,startedAt:m.dateCreated?.toISOString(),price:m.price,currency:m.priceUnit?.toUpperCase(),billingReference:m.sid,source:'Twilio Message resource'},...extra};
}
export interface BillingProvider {call(sid:string):Promise<EventInput>;message(sid:string):Promise<EventInput>;}
export const twilioBilling:BillingProvider={async call(sid){return callRecord(await billingClient().calls(sid).fetch());},async message(sid){return messageRecord(await billingClient().messages(sid).fetch());}};

// Only a non-overlapping account category is imported here. Importing totalprice
// or calls/SMS aggregates alongside per-resource prices would double count.
export async function phoneNumberCharges(now=new Date()):Promise<EventInput[]>{
  const start=new Date(now);start.setUTCDate(1);start.setUTCHours(0,0,0,0);
  const page=await billingClient().usage.records.daily.page({category:'phonenumbers',startDate:start,endDate:now,includeSubaccounts:false,pageSize:35});
  return page.instances.map(r=>({key:`account:phonenumbers:${r.accountSid}:${r.startDate.toISOString()}:${hash([r.price,r.usage])}`,type:'billing.usage.reconciled',category:'BILLING',provider:'twilio',accountId:r.accountSid,resourceId:`account:phonenumbers:${r.startDate.toISOString().slice(0,10)}`,interactionId:null,occurredAt:now.toISOString(),status:'provider_reported',data:{service:'phone_numbers',quantity:r.usage||null,unit:r.usageUnit||'unknown',startedAt:r.startDate.toISOString(),endedAt:r.endDate.toISOString(),price:String(r.price),priceConvention:'expense',currency:r.priceUnit.toUpperCase(),billingReference:r.uri,source:'Twilio daily UsageRecords: phonenumbers; account only, no subaccounts'}}));
}
