import { createHash } from 'node:crypto';
import twilio from 'twilio';
import { insideCallingHours } from './policy';
import type { AgentConfig } from './config';

export function voiceClient() {
  if(!process.env.TWILIO_ACCOUNT_SID||!process.env.TWILIO_AUTH_TOKEN)throw new Error('Twilio unavailable');
  return twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN,{timeout:10000,autoRetry:false});
}
export type Slot={id:string;start:string;end:string;label:string};
export interface CalendarProvider {
  availability(config:AgentConfig,start:string,end:string,signal:AbortSignal):Promise<Slot[]>;
  book(config:AgentConfig,slot:Slot,key:string,contact:{name:string|null;phone:string},signal:AbortSignal):Promise<{id:string;url:string|null}>;
}
export function calendarConfigured() { return !!(process.env.GOOGLE_CALENDAR_ID&&process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&process.env.GOOGLE_REFRESH_TOKEN); }
export class GoogleCalendar implements CalendarProvider {
  private cachedToken:{value:string;expiresAt:number}|null=null;
  private async token(signal:AbortSignal) {
    if(this.cachedToken&&Date.now()<this.cachedToken.expiresAt-60000)return this.cachedToken.value;
    if(!calendarConfigured())throw new Error('calendar_unavailable');
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',signal,body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID!,client_secret:process.env.GOOGLE_CLIENT_SECRET!,refresh_token:process.env.GOOGLE_REFRESH_TOKEN!,grant_type:'refresh_token'})});
    if(!response.ok)throw new Error('calendar_auth_failed');
    const data=await response.json();if(!data.access_token)throw new Error('calendar_auth_failed');this.cachedToken={value:data.access_token as string,expiresAt:Date.now()+Math.max(0,Number(data.expires_in)||3600)*1000};return this.cachedToken.value;
  }
  private async free(start:string,end:string,signal:AbortSignal) {
    const token=await this.token(signal),calendar=process.env.GOOGLE_CALENDAR_ID!;
    const res=await fetch('https://www.googleapis.com/calendar/v3/freeBusy',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},signal,body:JSON.stringify({timeMin:start,timeMax:end,items:[{id:calendar}]})});
    if(!res.ok)throw new Error('calendar_availability_failed');
    const data=await res.json(),result=data.calendars?.[calendar];
    if(!result||result.errors?.length||!Array.isArray(result.busy))throw new Error('calendar_availability_failed');
    return result.busy as {start:string;end:string}[];
  }
  async availability(config:AgentConfig,start:string,end:string,signal:AbortSignal) {
    const busy=await this.free(start,end,signal),slots:Slot[]=[];
    let stamp=Math.ceil(Math.max(Date.parse(start),Date.now()+3600000)/1800000)*1800000;
    for(;stamp+1800000<=Date.parse(end)&&slots.length<3;stamp+=1800000) {
      const until=stamp+1800000;
      if(!insideCallingHours(config,config.timezone,new Date(stamp))||!insideCallingHours(config,config.timezone,new Date(until-1)))continue;
      if(busy.some(b=>Date.parse(b.start)<until&&Date.parse(b.end)>stamp))continue;
      const iso=new Date(stamp).toISOString();
      slots.push({id:createHash('sha256').update(iso+config.timezone).digest('hex').slice(0,24),start:iso,end:new Date(until).toISOString(),label:new Intl.DateTimeFormat('en-US',{timeZone:config.timezone,weekday:'long',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(stamp)});
    }
    return slots;
  }
  async book(config:AgentConfig,slot:Slot,key:string,contact:{name:string|null;phone:string},signal:AbortSignal) {
    const busy=await this.free(slot.start,slot.end,signal);if(busy.length)throw new Error('slot_no_longer_available');
    const token=await this.token(signal),id=createHash('sha256').update(key).digest('hex');
    const url=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(process.env.GOOGLE_CALENDAR_ID!)}/events`;
    const res=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},signal,body:JSON.stringify({id,summary:`Website consultation — ${contact.name||'Caller'}`,description:`Caller: ${contact.phone}. Booked with explicit confirmation through the AI assistant. Reference: ${key}`,start:{dateTime:slot.start,timeZone:config.timezone},end:{dateTime:slot.end,timeZone:config.timezone}})});
    if(res.status===409){const existing=await fetch(`${url}/${id}`,{headers:{Authorization:`Bearer ${token}`},signal});if(existing.ok){const event=await existing.json();return {id:event.id,url:event.htmlLink||null};}}
    if(!res.ok)throw new Error('calendar_booking_failed');
    const event=await res.json();if(!event.id||event.status==='cancelled')throw new Error('calendar_booking_failed');return {id:event.id as string,url:(event.htmlLink||null) as string|null};
  }
}
