import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { contacts, aiAgents, aiLeadMemory, aiSettings, aiSessions, aiMessages, aiEvents, aiTools, aiUsage, aiQualifications, aiRateCards } from '@/db/schema';
import { defaultAgent, workspaceSchema, type Agent, type AgentConfig, type WorkspaceConfig } from './config';
import type { Session, Transcript, CallEvent, ToolExecution, Usage, Qualification, Rate, Lead, Snapshot } from './types';
import { demoStore } from '../demo';

export interface Store {
  agents(): Promise<Agent[]>; saveAgent(id: string, config: AgentConfig): Promise<Agent>;
  settings(): Promise<WorkspaceConfig>; saveSettings(config: WorkspaceConfig): Promise<void>;
  lead(id: string): Promise<Lead|null>; leadByPhone(phone: string): Promise<Lead>; saveLead(lead: Lead): Promise<void>;
  getLeads():Promise<Lead[]>;
  sessions(): Promise<Session[]>; session(id: string): Promise<Session|null>; createSession(session: Session): Promise<void>;
  patchSession(id: string, patch: Partial<Session>): Promise<void>; bindCall(id: string, callSid: string): Promise<boolean>;
  advanceStatus(id:string,status:string,patch:Partial<Session>):Promise<void>;
  claimRelay(id:string,owner:string):Promise<boolean>;
  messages(id: string): Promise<Transcript[]>; addMessage(message: Transcript): Promise<void>; patchMessage(id: string, patch: Partial<Transcript>): Promise<void>;
  event(sessionId: string, kind: string, data?: Record<string,unknown>): Promise<void>; events(id: string): Promise<CallEvent[]>;
  tools(id: string): Promise<ToolExecution[]>; claimTool(tool: ToolExecution): Promise<boolean>; finishTool(id: string, patch: Partial<ToolExecution>): Promise<void>;
  usage(id?: string): Promise<Usage[]>; recordUsage(usage: Usage): Promise<void>;
  qualifications(id: string): Promise<Qualification[]>; saveQualification(value: Qualification): Promise<void>;
  rates(): Promise<Rate[]>; addRate(rate: Rate): Promise<void>; prune(before: string): Promise<void>;
}
const now = () => new Date().toISOString();
export function newSession(agent: Agent, lead: Lead, direction: Session['direction'], simulation = false): Session {
  const agentSnapshot=structuredClone(agent.config);
  // Leave time for ending and durable cleanup before the 300s function deadline.
  if(process.env.AI_GATEWAY_MODE==='vercel')agentSnapshot.maxDurationSeconds=Math.min(agentSnapshot.maxDurationSeconds,240);
  return { id: crypto.randomUUID(), agentId: agent.id, contactId: lead.id, callSid: null, phone: lead.phone, direction, state: 'INITIALIZING', connectionStatus: 'queued', startedAt: null, endedAt: null, createdAt: now(), durationSeconds: 0, relaySeconds: 0, outcome: null, summary: '', simulation, agentSnapshot, memory: {}, cohort: 'optimized', experiment: '' };
}
export function usageEvent(sessionId: string, key: string, category: string, quantity: string, unit: string, model = '', metadata: Record<string,unknown> = {}): Usage {
  return { id: crypto.randomUUID(), sessionId, key, category, quantity, unit, model, metadata, estimated: true, finalizedUsd: null, createdAt: now() };
}
export async function snapshot(store: Store, id: string): Promise<Snapshot|null> {
  const session = await store.session(id); if (!session) return null;
  const [messages, events, tools, usage, qualifications] = await Promise.all([store.messages(id), store.events(id), store.tools(id), store.usage(id), store.qualifications(id)]);
  return { session, messages, events, tools, usage, qualifications };
}

export class PostgresStore implements Store {
  constructor(readonly database:typeof db=db) {}
  async agents() {
    let rows = await this.database().select().from(aiAgents).orderBy(asc(aiAgents.updatedAt));
    if (!rows.length) {
      await this.database().insert(aiAgents).values({ id: 'aaaaaaaa-0000-4000-8000-000000000001', config: defaultAgent() }).onConflictDoNothing();
      rows = await this.database().select().from(aiAgents).orderBy(asc(aiAgents.updatedAt));
    }
    return rows;
  }
  async saveAgent(id: string, config: AgentConfig) {
    const [row] = await this.database().insert(aiAgents).values({ id, config }).onConflictDoUpdate({ target: aiAgents.id, set: { config, updatedAt: now() } }).returning(); return row;
  }
  async settings() { const [row] = await this.database().select().from(aiSettings).where(eq(aiSettings.id, 'workspace')); return row ? workspaceSchema.parse(row.config) : workspaceSchema.parse({}); }
  async saveSettings(config: WorkspaceConfig) { await this.database().insert(aiSettings).values({ id: 'workspace', config }).onConflictDoUpdate({ target: aiSettings.id, set: { config } }); }
  async lead(id: string): Promise<Lead|null> {
    const [c] = await this.database().select().from(contacts).where(eq(contacts.id, id)); if (!c) return null;
    const [m] = await this.database().select().from(aiLeadMemory).where(eq(aiLeadMemory.contactId, id));
    return { id, phone: c.phone, name: c.name, optedOut: c.optedOut, details: m?.details || {}, consentAt: m?.consentAt || null, consentEvidence: m?.consentEvidence || '', timezone: m?.timezone || 'America/New_York' };
  }
  async getLeads():Promise<Lead[]> {
    const rows=await this.database().select().from(contacts).leftJoin(aiLeadMemory,eq(contacts.id,aiLeadMemory.contactId));
    return rows.map(({contacts:c,ai_lead_memory:m})=>({id:c.id,phone:c.phone,name:c.name,optedOut:c.optedOut,details:m?.details||{},consentAt:m?.consentAt||null,consentEvidence:m?.consentEvidence||'',timezone:m?.timezone||'America/New_York'}));
  }
  async leadByPhone(phone: string) {
    const [c] = await this.database().insert(contacts).values({ phone }).onConflictDoUpdate({ target: contacts.phone, set: { phone } }).returning(); return (await this.lead(c.id))!;
  }
  async saveLead(lead: Lead) {
    // Never clear a concurrent opt-out while updating lead facts or consent.
    await this.database().update(contacts).set({ name: sql`coalesce(${contacts.name}, ${lead.name})`, ...(lead.optedOut ? { optedOut: true } : {}) }).where(eq(contacts.id, lead.id));
    await this.database().insert(aiLeadMemory).values({ contactId: lead.id, details: lead.details, consentAt: lead.consentAt, consentEvidence: lead.consentEvidence, timezone: lead.timezone }).onConflictDoUpdate({ target: aiLeadMemory.contactId, set: { details: lead.details, consentAt: lead.consentAt, consentEvidence: lead.consentEvidence, timezone: lead.timezone } });
  }
  async sessions() { return this.database().select().from(aiSessions).orderBy(desc(aiSessions.createdAt)); }
  async session(id: string) { const [row] = await this.database().select().from(aiSessions).where(eq(aiSessions.id, id)); return row || null; }
  async createSession(session: Session) { await this.database().insert(aiSessions).values(session); }
  async claimRelay(id:string,owner:string) {
    const rows=await this.database().update(aiSessions).set({memory:sql`${aiSessions.memory} || jsonb_build_object('relayOwner', ${owner}::text)`}).where(and(eq(aiSessions.id,id),isNull(aiSessions.endedAt),sql`${aiSessions.memory}->>'relayOwner' is null`)).returning({id:aiSessions.id});
    return rows.length===1;
  }
  async patchSession(id: string, patch: Partial<Session>) { await this.database().update(aiSessions).set(patch).where(eq(aiSessions.id, id)); }
  async advanceStatus(id:string,status:string,patch:Partial<Session>) {
    const rank=(column:unknown)=>sql`case ${column} when 'queued' then 0 when 'initiated' then 1 when 'ringing' then 2 when 'in-progress' then 3 else 5 end`;
    await this.database().update(aiSessions).set({...patch,connectionStatus:status,
      ...(patch.state?{state:sql`case when ${aiSessions.state} in ('COMPLETED','FAILED','OPTED_OUT','VOICEMAIL','NO_ANSWER','BUSY','CANCELED') then ${aiSessions.state} else ${patch.state} end`}:{}),
    }).where(and(eq(aiSessions.id,id),sql`${rank(aiSessions.connectionStatus)} <= ${rank(status)}`));
  }
  async bindCall(id: string, callSid: string) {
    const rows = await this.database().update(aiSessions).set({ callSid }).where(and(eq(aiSessions.id, id), sql`(${aiSessions.callSid} is null or ${aiSessions.callSid} = ${callSid})`)).returning({ id: aiSessions.id }); return !!rows.length;
  }
  async messages(id: string) { return this.database().select().from(aiMessages).where(eq(aiMessages.sessionId, id)).orderBy(asc(aiMessages.createdAt)); }
  async addMessage(message: Transcript) { await this.database().insert(aiMessages).values(message); }
  async patchMessage(id: string, patch: Partial<Transcript>) { await this.database().update(aiMessages).set(patch).where(eq(aiMessages.id,id)); }
  async event(sessionId: string, kind: string, data: Record<string,unknown> = {}) { await this.database().insert(aiEvents).values({ sessionId, kind, data }); }
  async events(id: string) { return this.database().select().from(aiEvents).where(eq(aiEvents.sessionId, id)).orderBy(asc(aiEvents.createdAt)); }
  async tools(id: string) { return this.database().select().from(aiTools).where(eq(aiTools.sessionId, id)).orderBy(asc(aiTools.createdAt)); }
  async claimTool(tool: ToolExecution) { return !!(await this.database().insert(aiTools).values(tool).onConflictDoNothing().returning()).length; }
  async finishTool(id: string, patch: Partial<ToolExecution>) { await this.database().update(aiTools).set(patch).where(eq(aiTools.id, id)); }
  async usage(id?: string) { return id ? this.database().select().from(aiUsage).where(eq(aiUsage.sessionId, id)) : this.database().select().from(aiUsage); }
  async recordUsage(value: Usage) {
    if(value.key==='voice_duration'||value.key==='relay_duration'){
      const [previous]=await this.database().select().from(aiUsage).where(and(eq(aiUsage.sessionId,value.sessionId),eq(aiUsage.key,value.key)));
      if(previous&&(previous.finalizedUsd!==null||(String(previous.metadata.source||'').startsWith('Twilio')&&!String(value.metadata.source||'').startsWith('Twilio'))))return;
    }
    await this.database().insert(aiUsage).values(value).onConflictDoUpdate({ target: [aiUsage.sessionId,aiUsage.key], set: { quantity: value.quantity, metadata: value.metadata, finalizedUsd: value.finalizedUsd, estimated: value.estimated } });
  }
  async qualifications(id: string) { return this.database().select().from(aiQualifications).where(eq(aiQualifications.sessionId, id)).orderBy(asc(aiQualifications.createdAt)); }
  async saveQualification(value: Qualification) { await this.database().insert(aiQualifications).values(value); }
  async rates() { return this.database().select().from(aiRateCards).orderBy(desc(aiRateCards.effectiveAt)); }
  async addRate(rate: Rate) { await this.database().insert(aiRateCards).values(rate).onConflictDoNothing(); }
  async prune(before: string) {
    // Keep aggregate billing/session metadata; delete text and tool payloads on completed calls only.
    const expired = sql`select id from ai_call_sessions where ended_at < ${before}::timestamptz`;
    await this.database().delete(aiMessages).where(sql`${aiMessages.sessionId} in (${expired})`);
    await this.database().delete(aiTools).where(sql`${aiTools.sessionId} in (${expired})`);
    await this.database().delete(aiEvents).where(sql`${aiEvents.sessionId} in (${expired})`);
    await this.database().delete(aiQualifications).where(sql`${aiQualifications.sessionId} in (${expired})`);
    await this.database().update(aiSessions).set({ memory: {}, summary: '[Transcript retention expired]' }).where(and(sql`${aiSessions.endedAt} < ${before}::timestamptz`, sql`not ${isNull(aiSessions.endedAt)}`));
  }
}

// Used only for tests and clearly marked DEMO_MODE preview. Never silently falls back from Postgres.
export class MemoryStore implements Store {
  agentRows: Agent[] = [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', config: defaultAgent(), updatedAt: now() }];
  setting = workspaceSchema.parse({}); leads = new Map<string,Lead>(); sessionRows = new Map<string,Session>(); messageRows: Transcript[] = []; eventRows: CallEvent[] = []; toolRows: ToolExecution[] = []; usageRows: Usage[] = []; qualificationRows: Qualification[] = []; rateRows: Rate[] = [];
  async agents() { return structuredClone(this.agentRows); }
  async saveAgent(id: string, config: AgentConfig) { const row = { id, config, updatedAt: now() }; this.agentRows = [...this.agentRows.filter(a=>a.id!==id), structuredClone(row)]; return row; }
  async settings() { return structuredClone(this.setting); } async saveSettings(v: WorkspaceConfig) { this.setting=structuredClone(v); }
  async lead(id: string) { return structuredClone(this.leads.get(id) || null); }
  async getLeads(){return structuredClone([...this.leads.values()]);}
  async leadByPhone(phone: string) { let lead = [...this.leads.values()].find(l=>l.phone===phone); if (!lead) { lead={ id: crypto.randomUUID(), phone, name:null, optedOut:false, details:{}, consentAt:null, consentEvidence:'', timezone:'America/New_York' }; this.leads.set(lead.id,lead); } return structuredClone(lead); }
  async saveLead(v: Lead) { this.leads.set(v.id, structuredClone({...v, optedOut: v.optedOut || this.leads.get(v.id)?.optedOut || false})); }
  async sessions() { return structuredClone([...this.sessionRows.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))); }
  async session(id: string) { return structuredClone(this.sessionRows.get(id) || null); }
  async createSession(v: Session) { if (!v.simulation && [...this.sessionRows.values()].some(s=>!s.simulation&&!s.endedAt)) throw new Error('One active demo call is already reserved'); this.sessionRows.set(v.id,structuredClone(v)); }
  async claimRelay(id:string,owner:string) {const s=this.sessionRows.get(id);if(!s||s.endedAt||s.memory.relayOwner)return false;s.memory.relayOwner=owner;return true;}
  async patchSession(id: string, patch: Partial<Session>) { const s=this.sessionRows.get(id); if(s)Object.assign(s,structuredClone(patch)); }
  async advanceStatus(id:string,status:string,patch:Partial<Session>) { const s=this.sessionRows.get(id);if(!s)return;const r:Record<string,number>={queued:0,initiated:1,ringing:2,'in-progress':3};if((r[status]??5)<(r[s.connectionStatus]??5))return;const terminal=['COMPLETED','FAILED','OPTED_OUT','VOICEMAIL','NO_ANSWER','BUSY','CANCELED'].includes(s.state);Object.assign(s,structuredClone({...patch,connectionStatus:status,...(terminal?{state:s.state}:{})})); }
  async bindCall(id: string, callSid: string) { const s=this.sessionRows.get(id); if(!s||(s.callSid&&s.callSid!==callSid))return false;s.callSid=callSid;return true; }
  async messages(id: string) { return structuredClone(this.messageRows.filter(m=>m.sessionId===id)); }
  async addMessage(v: Transcript) { this.messageRows.push(structuredClone(v)); }
  async patchMessage(id: string, patch: Partial<Transcript>) { const m=this.messageRows.find(m=>m.id===id);if(m)Object.assign(m,structuredClone(patch)); }
  async event(sessionId: string,kind: string,data: Record<string,unknown>={}) { this.eventRows.push({id:crypto.randomUUID(),sessionId,kind,data:structuredClone(data),createdAt:now()}); }
  async events(id: string) { return structuredClone(this.eventRows.filter(e=>e.sessionId===id)); }
  async tools(id: string) { return structuredClone(this.toolRows.filter(e=>e.sessionId===id)); }
  async claimTool(v: ToolExecution) { if(this.toolRows.some(t=>t.sessionId===v.sessionId&&t.key===v.key))return false;this.toolRows.push(structuredClone(v));return true; }
  async finishTool(id: string,patch: Partial<ToolExecution>) { const t=this.toolRows.find(t=>t.id===id);if(t)Object.assign(t,structuredClone(patch)); }
  async usage(id?: string) { return structuredClone(this.usageRows.filter(e=>!id||e.sessionId===id)); }
  async recordUsage(v: Usage) { const old=this.usageRows.find(u=>u.sessionId===v.sessionId&&u.key===v.key);if(old&&(old.finalizedUsd!==null||(String(old.metadata.source||'').startsWith('Twilio')&&!String(v.metadata.source||'').startsWith('Twilio'))))return;this.usageRows=[...this.usageRows.filter(u=>u.sessionId!==v.sessionId||u.key!==v.key),structuredClone({...v,createdAt:old?.createdAt||v.createdAt})]; }
  async qualifications(id: string) { return structuredClone(this.qualificationRows.filter(e=>e.sessionId===id)); }
  async saveQualification(v: Qualification) { this.qualificationRows.push(structuredClone(v)); }
  async rates() { return structuredClone(this.rateRows); } async addRate(v: Rate) { this.rateRows.push(structuredClone(v)); }
  async prune() { /* Tests use an explicit, ephemeral store. */ }
}
declare global { var clarityAiPreview: MemoryStore|undefined; }
export function getStore(): Store {
  if(process.env.DEMO_MODE!=='1')return new PostgresStore();
  const store=globalThis.clarityAiPreview ||= new MemoryStore();
  for(const c of demoStore().contacts)if(!store.leads.has(c.id))store.leads.set(c.id,{id:c.id,phone:c.phone,name:c.name,optedOut:c.optedOut,details:{},consentAt:null,consentEvidence:'',timezone:'America/New_York'});
  return store;
}
