import type { Rate, Session, Usage } from './types';
import type { Store } from './store';
import type { WorkspaceConfig } from './config';

// Nine decimal places, integer arithmetic. JSON/API amounts are decimal strings.
const SCALE = BigInt(1000000000);
const RATE_SCALE=BigInt(1000000000000);
function rateDecimal(value:string){if(!/^\d+(\.\d{1,12})?$/.test(value))throw new Error('Expected nonnegative rate with up to twelve places');const [whole,fraction='']=value.split('.');return BigInt(whole)*RATE_SCALE+BigInt(fraction.padEnd(12,'0'));}
export function decimal(value: string) {
  if (!/^\d+(\.\d{1,9})?$/.test(value)) throw new Error('Expected nonnegative decimal with up to nine places');
  const [whole, fraction=''] = value.split('.'); return BigInt(whole)*SCALE + BigInt(fraction.padEnd(9,'0'));
}
export function amount(value: bigint) { return `${value/SCALE}.${(value%SCALE).toString().padStart(9,'0')}`; }
function ceilDiv(n: bigint,d: bigint) { return (n+d-BigInt(1))/d; }
export type CostBreakdown = ReturnType<typeof estimate>;
export function estimate(usage: Usage[], rates: Rate[], exchange: WorkspaceConfig['exchangeRate'] = null) {
  let total=BigInt(0),finalized=BigInt(0); const categories: Record<string,bigint>={}; const missing: string[]=[];
  const lines=usage.map(u=>{
    const candidates=rates.filter(r=>r.category===u.category&&r.model===u.model&&r.effectiveAt<=u.createdAt).sort((a,b)=>b.effectiveAt.localeCompare(a.effectiveAt));
    const rate=candidates[0]; let cost: bigint|null=null;
    if (u.finalizedUsd!==null) { finalized+=decimal(u.finalizedUsd); }
    if (rate) {
      let quantity=decimal(u.quantity);
      if (u.unit==='second'&&rate.unit==='minute') {
        const increment=BigInt(rate.increment)*SCALE;
        quantity=ceilDiv(quantity,increment)*increment;
        cost=ceilDiv(quantity*rateDecimal(rate.usdPerUnit),RATE_SCALE*BigInt(60));
      } else if (rate.unit===u.unit) cost=ceilDiv(quantity*rateDecimal(rate.usdPerUnit),RATE_SCALE);
      if (rate.bundled) cost=BigInt(0);
    }
    // Explicitly bundled STT/TTS events cannot be billed again by a second rate card.
    if (u.metadata.bundled===true) cost=BigInt(0);
    if (cost===null) missing.push(`${u.category}:${u.model||'default'}`);
    else { total+=cost; categories[u.category]=(categories[u.category]||BigInt(0))+cost; }
    return { usageId:u.id,category:u.category,model:u.model,quantity:u.quantity,unit:u.unit,estimatedUsd:cost===null?null:amount(cost),finalizedUsd:u.finalizedUsd,rateId:rate?.id||null,rateSource:rate?.source||null,effectiveAt:rate?.effectiveAt||null,bundled:u.metadata.bundled===true||rate?.bundled===true };
  });
  return { estimated:true as const,currency:'USD',totalEstimatedUsd:amount(total),finalizedUsd:amount(finalized),complete:missing.length===0,missingRates:[...new Set(missing)],
    usageIncomplete:usage.some(u=>u.metadata.usageIncomplete===true), costs:Object.fromEntries(Object.entries(categories).map(([k,v])=>[k,amount(v)])),lines,
    estimatedInr:exchange?amount(total*decimal(exchange.usdInr)/SCALE):null, exchangeRate:exchange,
    llmUsage:{inputTokens:sum('llm_input')+sum('llm_cached_input'),cachedInputTokens:sum('llm_cached_input'),cacheWriteTokens:sum('llm_cache_write'),outputTokens:sum('llm_output')},
  };
  function sum(category:string) { return usage.filter(u=>u.category===category).reduce((n,u)=>n+Number(u.quantity),0); }
}
export class CostEngine {
  constructor(readonly store: Store) {}
  async recordUsage(event: Usage) { decimal(event.quantity); if(event.finalizedUsd!==null)decimal(event.finalizedUsd); await this.store.recordUsage(event); }
  async getCostBreakdown(id:string) { const [u,r,s]=await Promise.all([this.store.usage(id),this.store.rates(),this.store.settings()]);return estimate(u,r,s.exchangeRate); }
  estimateCallCost(id:string) { return this.getCostBreakdown(id); }
  async getMonthlyUsage(now=new Date()) {
    const [sessions,usage,rates,settings]=await Promise.all([this.store.sessions(),this.store.usage(),this.store.rates(),this.store.settings()]);
    const month=now.toISOString().slice(0,7),day=now.toISOString().slice(0,10);
    const real=new Set(sessions.filter(s=>!s.simulation).map(s=>s.id));
    const current=usage.filter(u=>real.has(u.sessionId));
    return { today:estimate(current.filter(u=>u.createdAt.startsWith(day)),rates,settings.exchangeRate),month:estimate(current.filter(u=>u.createdAt.startsWith(month)),rates,settings.exchangeRate),periodTimezone:'UTC' };
  }
  async evaluateBudget(session?:Session) {
    const [settings,period,usage,tools]=await Promise.all([this.store.settings(),this.getMonthlyUsage(),session?this.store.usage(session.id):Promise.resolve([]),session?this.store.tools(session.id):Promise.resolve([])]);
    const reasons:string[]=[];
    if(decimal(period.today.totalEstimatedUsd)>=decimal(settings.dailyBudgetUsd))reasons.push('Daily workspace budget reached');
    if(decimal(period.month.totalEstimatedUsd)>=decimal(settings.monthlyBudgetUsd))reasons.push('Monthly workspace budget reached');
    if(session) {
      const cost=await this.getCostBreakdown(session.id),requests=new Set(usage.filter(u=>u.category.startsWith('llm_')).map(u=>u.key.split(':')[0])).size;
      if(decimal(cost.totalEstimatedUsd)>=decimal(session.agentSnapshot.maxCostUsd))reasons.push('Expected conversation cost reached');
      if(session.durationSeconds>0&&decimal(cost.totalEstimatedUsd)*BigInt(60)>decimal(session.agentSnapshot.maxCostPerMinuteUsd)*BigInt(Math.max(60,session.durationSeconds)))reasons.push('Expected cost per minute exceeded');
      if(requests>=session.agentSnapshot.maxRequests)reasons.push('LLM request limit reached');
      if(tools.length>=session.agentSnapshot.maxTools)reasons.push('Tool execution limit reached');
      if(cost.llmUsage.inputTokens+cost.llmUsage.outputTokens>=session.agentSnapshot.tokenWarning)reasons.push('Token warning threshold reached');
    }
    return { exceeded:reasons.length>0,reasons,action:settings.budgetAction,blockNewOutbound:settings.outboundPaused||(reasons.length>0&&settings.budgetAction==='block_outbound'),period };
  }
  async getAgentCostMetrics(agentId?:string) {
    const [sessions,usage,rates,settings]=await Promise.all([this.store.sessions(),this.store.usage(),this.store.rates(),this.store.settings()]);
    const real=sessions.filter(s=>!s.simulation&&(!agentId||s.agentId===agentId));
    const ids=new Set(real.map(s=>s.id)),selected=usage.filter(u=>ids.has(u.sessionId)),cost=estimate(selected,rates,settings.exchangeRate);
    const minutes=real.reduce((n,s)=>n+s.durationSeconds/60,0),qualified=real.filter(s=>['Interested','Meeting requested','Meeting booked'].includes(s.outcome||'')).length,booked=real.filter(s=>s.outcome==='Meeting booked').length;
    const divide=(n:number)=>n?amount(decimal(cost.totalEstimatedUsd)*BigInt(1000)/BigInt(Math.round(n*1000))):null;
    const models=[...new Set(selected.filter(u=>u.category.startsWith('llm_')).map(u=>u.model))].map(model=>{
      const rows=selected.filter(u=>u.model===model&&u.category.startsWith('llm_')),requests=rows.filter(u=>u.category==='llm_input');
      return { model,requests:requests.length,averageLatencyMs:requests.length?requests.reduce((n,u)=>n+Number(u.metadata.latencyMs||0),0)/requests.length:null,escalations:requests.filter(u=>u.metadata.escalated).length,cost:estimate(rows,rates),usage:estimate(rows,rates).llmUsage };
    });
    const cohorts=[...new Set(real.map(s=>`${s.experiment}:${s.cohort}`))].map(key=>{
      const calls=real.filter(s=>`${s.experiment}:${s.cohort}`===key),set=new Set(calls.map(s=>s.id));
      return { key,count:calls.length,cost:estimate(selected.filter(u=>set.has(u.sessionId)),rates),averageDurationSeconds:calls.reduce((n,s)=>n+s.durationSeconds,0)/calls.length,qualified:calls.filter(s=>['Interested','Meeting requested','Meeting booked'].includes(s.outcome||'')).length,booked:calls.filter(s=>s.outcome==='Meeting booked').length,failures:calls.filter(s=>s.state==='FAILED').length };
    });
    const observations=await Promise.all(real.map(async s=>({messages:await this.store.messages(s.id),tools:await this.store.tools(s.id),events:await this.store.events(s.id)})));
    const callsWithOutcome=real.filter(s=>s.outcome&&s.outcome!=='Unresolved').length;
    const totalTurns=observations.reduce((n,o)=>n+o.messages.filter(m=>m.role==='user').length,0),allTools=observations.flatMap(o=>o.tools),turnEvents=observations.flatMap(o=>o.events.filter(e=>e.kind==='turn_completed'));
    let questions=0,repeated=0;for(const o of observations){const seen=new Set<string>();for(const m of o.messages.filter(m=>m.role==='assistant')){for(const q of m.text.match(/[^.!?]+\?/g)||[]){questions++;const normalized=q.toLowerCase().replace(/[^a-z0-9]/g,'');if(seen.has(normalized))repeated++;seen.add(normalized);}}}
    const conversation={averageDurationSeconds:real.length?minutes*60/real.length:null,averageTurns:real.length?totalTurns/real.length:null,qualificationCompletionRate:real.length?callsWithOutcome/real.length:null,bookingRate:real.length?booked/real.length:null,
      interruptions:observations.reduce((n,o)=>n+o.events.filter(e=>e.kind==='interruption').length,0),repeatedQuestionRate:questions?repeated/questions:null,
      toolSuccessRate:allTools.length?allTools.filter(t=>t.status==='succeeded').length/allTools.length:null,
      averageFirstResponseMs:turnEvents.filter(e=>typeof e.data.firstResponseMs==='number').length?turnEvents.reduce((n,e)=>n+Number(e.data.firstResponseMs||0),0)/turnEvents.filter(e=>typeof e.data.firstResponseMs==='number').length:null,
      speechTimingAvailable:false,
    };
    return {calls:real.length,minutes,qualified,booked,cost,averageCostPerCall:divide(real.length),costPerMinute:divide(minutes),costPerQualifiedLead:divide(qualified),costPerBooking:divide(booked),models,cohorts,conversation};
  }
}
