import { createHash } from 'node:crypto';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { conversations, messages } from '@/db/schema';
import { publicAppUrl, twilioNumber } from '@/lib/twilio';
import { normalizePhone } from '@/lib/phone';
import { outcomes, toolNames } from './config';
import { confirmationEvidence } from './policy';
import { GoogleCalendar, voiceClient, type CalendarProvider, type Slot } from './providers';
import { CostEngine } from './cost';
import { usageEvent, type Store } from './store';
import type { Session, ToolExecution } from './types';

const evidence=z.array(z.uuid()).min(1).max(20);
export const toolSchemas={
  lookup_lead:z.object({}).strict(),
  update_lead:z.object({fields:z.object({businessName:z.string().max(200).optional(),contactName:z.string().max(100).optional(),industry:z.string().max(200).optional(),website:z.string().max(300).optional(),problem:z.string().max(500).optional(),objective:z.string().max(500).optional(),timeline:z.string().max(200).optional(),budget:z.string().max(100).optional(),followupPreference:z.string().max(100).optional()}).strict(),evidenceMessageIds:evidence}).strict(),
  save_qualification:z.object({outcome:z.enum(outcomes),summary:z.string().min(1).max(1200),evidenceMessageIds:evidence}).strict(),
  check_calendar_availability:z.object({start:z.iso.datetime(),end:z.iso.datetime()}).strict(),
  book_appointment:z.object({slotId:z.string().max(100),confirmationMessageId:z.uuid()}).strict(),
  send_demo_link:z.object({confirmationMessageId:z.uuid()}).strict(),
  send_followup:z.object({channel:z.enum(['sms','email']),confirmationMessageId:z.uuid()}).strict(),
  request_human_transfer:z.object({reason:z.string().max(400)}).strict(),
  mark_do_not_call:z.object({reason:z.string().max(400)}).strict(),
  end_call:z.object({reason:z.string().max(400)}).strict(),
};
const descriptions:Record<string,string>={lookup_lead:'Read only the contact associated with this call.',update_lead:'Fill unknown lead facts supported by exact caller transcript evidence; existing verified values are protected.',save_qualification:'Save an evidence-based outcome. Meeting booked requires a successful booking tool.',check_calendar_availability:'Get real available 30-minute slots, at most 7 days ahead. Use exact returned labels when asking for booking confirmation.',book_appointment:'Book a previously offered slot after the latest caller explicitly confirms the complete slot label.',send_demo_link:'Send only the operator-configured demo URL to this caller by SMS after permission.',send_followup:'Send the configured follow-up text to this caller after permission. Email is unavailable in this MVP.',request_human_transfer:'Attempt transfer to the configured agency human; success indicates initiation only.',mark_do_not_call:'Suppress all further outreach to this caller immediately.',end_call:'Conclude this call after saving its result.'};
const outputSchema=z.object({ok:z.boolean(),code:z.string()}).catchall(z.unknown());
export function llmTools(allowed:readonly string[]) {
  return toolNames.filter(name=>allowed.includes(name)).map(name=>({type:'function' as const,function:{name,description:descriptions[name],parameters:z.toJSONSchema(toolSchemas[name],{target:'draft-7'}),strict:false}}));
}
export type ToolResult={ok:boolean;code:string;[key:string]:unknown};
export type Effects={transfer:(s:Session)=>Promise<void>;end:(s:Session)=>Promise<void>;sms:(s:Session,body:string)=>Promise<{sid:string;status:string}>};
export const realEffects:Effects={
  async transfer(s) { await voiceClient().calls(s.callSid!).update({url:`${publicAppUrl()}/api/twilio/ai/transfer?session=${s.id}`,method:'POST'}); },
  async end(s) { await voiceClient().calls(s.callSid!).update({status:'completed'}); },
  async sms(s,body) {
    const sent=await voiceClient().messages.create({to:s.phone,from:twilioNumber(),body,statusCallback:`${publicAppUrl()}/api/twilio/status`});
    const [thread]=await db().insert(conversations).values({contactId:s.contactId,twilioNumber:twilioNumber()}).onConflictDoUpdate({target:[conversations.contactId,conversations.twilioNumber],set:{status:'open',lastMessageAt:new Date()}}).returning();
    await db().insert(messages).values({conversationId:thread.id,twilioSid:sent.sid,direction:'outbound',body,fromNumber:twilioNumber(),toNumber:s.phone,status:sent.status,numSegments:Number(sent.numSegments)||1}).onConflictDoNothing();
    await db().update(conversations).set({lastMessageAt:new Date()}).where(eq(conversations.id,thread.id));
    return {sid:sent.sid,status:sent.status};
  },
};
export class ToolRegistry {
  constructor(readonly store:Store,readonly calendar:CalendarProvider=new GoogleCalendar(),readonly effects:Effects=realEffects) {}
  async execute(sessionId:string,name:string,input:unknown,signal:AbortSignal):Promise<ToolResult> {
    const s=await this.store.session(sessionId);if(!s)return {ok:false,code:'session_not_found'};
    const mandatory=['mark_do_not_call','end_call'];
    if(!toolNames.includes(name as typeof toolNames[number])||(!mandatory.includes(name)&&!s.agentSnapshot.allowedTools.includes(name as typeof toolNames[number])))return this.denied(s,name,'tool_not_allowed');
    const schema=toolSchemas[name as keyof typeof toolSchemas],parsed=schema.safeParse(input);
    if(!parsed.success)return this.denied(s,name,'invalid_arguments');
    const args=parsed.data as Record<string,unknown>;
    if(name==='update_lead'&&Object.keys(args.fields as Record<string,unknown>).length===0)return this.denied(s,name,'new_evidence_backed_fields_required');
    if(signal.aborted&&!mandatory.includes(name))return {ok:false,code:'canceled'};
    const lead=await this.store.lead(s.contactId);if(!lead)return {ok:false,code:'lead_unavailable'};
    if(lead.optedOut&&['send_demo_link','send_followup','book_appointment'].includes(name))return this.denied(s,name,'contact_opted_out');
    const prior=await this.store.tools(s.id);
    if(!mandatory.includes(name)&&prior.length>=s.agentSnapshot.maxTools)return this.denied(s,name,'tool_limit');
    // Validate caller authority before reserving a side effect. A rejected permission check
    // can be corrected, while an uncertain provider write can never be retried blindly.
    if(['send_demo_link','send_followup','book_appointment'].includes(name)){
      const transcript=await this.store.messages(s.id);
      const offers=s.memory.calendarOffers as {slots:Slot[]}|undefined;
      const label=offers?.slots.find(slot=>slot.id===args.slotId)?.label;
      if(!confirmationEvidence(transcript,args.confirmationMessageId as string,name==='book_appointment'?'booking':'sms',label))return this.denied(s,name,'explicit_caller_confirmation_required');
    }
    const sideEffect=['book_appointment','send_demo_link','send_followup','request_human_transfer','mark_do_not_call','end_call'].includes(name);
    const existing=prior.find(t=>t.name===name&&['succeeded','unknown','pending'].includes(t.status));
    if(sideEffect&&existing)return existing.output as ToolResult||{ok:false,code:'action_pending_or_unknown_do_not_retry'};
    // Side effects get one durable semantic key, independent of model call IDs/retries.
    const key=sideEffect?name:createHash('sha256').update(name+JSON.stringify(args)+(name==='lookup_lead'?JSON.stringify(lead.details):'')+(s.agentSnapshot.optimizations.toolCache?Math.floor(Date.now()/(name==='check_calendar_availability'?30000:300000)) :crypto.randomUUID())).digest('hex');
    const execution:ToolExecution={id:crypto.randomUUID(),sessionId:s.id,name,key,input:args,output:null,status:'pending',durationMs:0,createdAt:new Date().toISOString()};
    if(!await this.store.claimTool(execution)) {
      const old=(await this.store.tools(s.id)).find(t=>t.key===key);
      return old?.output as ToolResult||{ok:false,code:'action_pending_or_unknown_do_not_retry'};
    }
    const start=Date.now(),timeout=AbortSignal.timeout(12000),combined=AbortSignal.any([signal,timeout]);
    let result:ToolResult,status:ToolExecution['status']='succeeded';
    try {
      result=await Promise.race([this.run(s,name,args,combined),new Promise<never>((_,reject)=>combined.addEventListener('abort',()=>reject(new Error('operation_timeout_or_canceled')),{once:true}))]);
      result=outputSchema.parse(result);if(!result.ok)status='failed';
    } catch { result={ok:false,code:sideEffect?'action_result_unknown_do_not_retry':signal.aborted?'canceled':'provider_unavailable'};status=sideEffect?'unknown':'failed'; }
    await this.store.finishTool(execution.id,{output:result,status,durationMs:Date.now()-start});
    await this.store.event(s.id,'tool_completed',{name,status,durationMs:Date.now()-start});return result;
  }
  private async denied(s:Session,name:string,code:string) { await this.store.event(s.id,'tool_denied',{name,code});return {ok:false,code}; }
  private async run(s:Session,name:string,a:Record<string,unknown>,signal:AbortSignal):Promise<ToolResult> {
    const lead=(await this.store.lead(s.contactId))!;
    const transcript=await this.store.messages(s.id),config=s.agentSnapshot;
    if(name==='lookup_lead')return {ok:true,code:'found',lead:{name:lead.name,details:lead.details}};
    if(name==='mark_do_not_call') {
      lead.optedOut=true;await this.store.saveLead(lead);
      await this.store.patchSession(s.id,{state:'OPTED_OUT',outcome:'Opted out'});
      await this.store.event(s.id,'opt_out',{source:'caller'});return {ok:true,code:'suppressed'};
    }
    if(name==='update_lead'||name==='save_qualification') {
      const ids=a.evidenceMessageIds as string[],evidence=transcript.filter(m=>m.role==='user'&&ids.includes(m.id));
      if(evidence.length!==ids.length)return {ok:false,code:'invalid_transcript_evidence'};
      if(name==='update_lead') {
        const fields=a.fields as Record<string,string>,text=evidence.map(m=>m.text.toLowerCase()).join(' '),protectedFields:string[]=[];
        for(const [key,value] of Object.entries(fields)) {
          if(!text.includes(value.toLowerCase()))return {ok:false,code:'field_not_supported_by_verbatim_evidence',field:key};
          if(lead.details[key]&&lead.details[key]!==value){protectedFields.push(key);continue;}
          if(key==='contactName'&&lead.name&&lead.name!==value){protectedFields.push(key);continue;}
          lead.details[key]=value;if(key==='contactName')lead.name=value;
        }
        await this.store.saveLead(lead);await this.store.patchSession(s.id,{state:'QUALIFICATION'});return {ok:true,code:'updated',details:lead.details,protectedFields};
      }
      if(a.outcome==='Meeting booked'&&!(await this.store.tools(s.id)).some(t=>t.name==='book_appointment'&&t.status==='succeeded'))return {ok:false,code:'no_confirmed_booking'};
      if(a.outcome==='Opted out')return {ok:false,code:'use_mark_do_not_call'};
      await this.store.saveQualification({id:crypto.randomUUID(),sessionId:s.id,contactId:lead.id,outcome:a.outcome as string,summary:a.summary as string,evidence:ids,attributes:lead.details,createdAt:new Date().toISOString()});
      await this.store.patchSession(s.id,{outcome:a.outcome as string,summary:a.summary as string,state:'QUALIFICATION'});return {ok:true,code:'qualification_saved',outcome:a.outcome};
    }
    if(name==='check_calendar_availability') {
      const start=Date.parse(a.start as string),end=Date.parse(a.end as string);
      if(end<=start||start<Date.now()-60000||end-Date.now()>8*86400000||end-start>7*86400000)return {ok:false,code:'invalid_calendar_window'};
      const slots=await this.calendar.availability(config,a.start as string,a.end as string,signal);
      await this.store.patchSession(s.id,{state:'SCHEDULING',memory:{...s.memory,calendarOffers:{at:new Date().toISOString(),slots}}});
      return {ok:true,code:slots.length?'available':'no_slots',slots,timezone:config.timezone};
    }
    if(name==='book_appointment') {
      const offers=s.memory.calendarOffers as {at:string;slots:Slot[]}|undefined;
      const slot=offers?.slots.find(slot=>slot.id===a.slotId);
      if(!offers||Date.now()-Date.parse(offers.at)>300000||!slot||Date.parse(slot.start)<=Date.now())return {ok:false,code:'slot_missing_or_stale_recheck'};
      if(!confirmationEvidence(transcript,a.confirmationMessageId as string,'booking',slot.label))return {ok:false,code:'explicit_slot_confirmation_required'};
      const booking=await this.calendar.book(config,slot,`ai${s.id.replaceAll('-','')}`,lead,signal);
      await this.store.patchSession(s.id,{state:'FOLLOW_UP',outcome:'Meeting booked',memory:{...s.memory,booking:{...booking,slot}}});
      await this.store.saveQualification({id:crypto.randomUUID(),sessionId:s.id,contactId:lead.id,outcome:'Meeting booked',summary:`Confirmed ${slot.label}`,evidence:[a.confirmationMessageId as string],attributes:lead.details,createdAt:new Date().toISOString()});
      return {ok:true,code:'booked',booking,slot};
    }
    if(name==='send_demo_link'||name==='send_followup') {
      if(name==='send_followup'&&a.channel==='email')return {ok:false,code:'email_unavailable'};
      if(!config.followupEnabled)return {ok:false,code:'followup_disabled'};
      if(!confirmationEvidence(transcript,a.confirmationMessageId as string,'sms'))return {ok:false,code:'explicit_sms_permission_required'};
      if((await this.store.lead(s.contactId))?.optedOut)return {ok:false,code:'contact_opted_out'};
      if(name==='send_demo_link'&&!config.demoUrl)return {ok:false,code:'demo_url_unavailable'};
      const body=name==='send_demo_link'?`${config.company}: Here is the website demo you requested: ${config.demoUrl}. Reply STOP to opt out.`:`${config.company}: ${config.followupText} Reply STOP to opt out.`;
      const sent=await this.effects.sms(s,body);
      if(['failed','undelivered','canceled'].includes(sent.status))return {ok:false,code:'message_rejected',providerStatus:sent.status};
      await new CostEngine(this.store).recordUsage(usageEvent(s.id,`sms:${sent.sid}`,'sms','1','message','US',{sid:sent.sid,providerStatus:sent.status,segmentsUnknown:true}));
      await this.store.patchSession(s.id,{state:'FOLLOW_UP'});return {ok:true,code:'accepted_for_delivery',sid:sent.sid,providerStatus:sent.status,deliveryConfirmed:sent.status==='delivered'};
    }
    if(name==='request_human_transfer') {
      if(!normalizePhone(config.transferNumber)||config.transferNumber===s.phone||normalizePhone(config.transferNumber)===normalizePhone(process.env.TWILIO_PHONE_NUMBER||''))return {ok:false,code:'human_unavailable',fallback:'Offer a callback request; no transfer was made.'};
      await this.store.patchSession(s.id,{state:'HUMAN_HANDOFF',outcome:'Human requested'});await this.effects.transfer(s);return {ok:true,code:'transfer_initiated',answered:false};
    }
    if(name==='end_call') { await this.effects.end(s);return {ok:true,code:'termination_requested'}; }
    return {ok:false,code:'unavailable'};
  }
}
