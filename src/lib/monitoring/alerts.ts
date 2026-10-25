import { and, eq, sql } from 'drizzle-orm';
import { monitoringAlertRules as rules, monitoringAlertInstances as alerts, monitoringBudgets as budgets } from '@/db/schema';
import { MonitoringStore, workspace } from './store';
import { costs, query, type Window } from './queries';
import { fixed, money, SCALE } from './money';
export function thresholdExceeded(value:string,threshold:string,samples:number,minSamples:number){return samples>=minSamples&&fixed(value)>=fixed(threshold);}
export function scopeSql(scope:string,id:string,alias:'r'|'u'='r'){
  const field=scope==='agent'?'agent_id':scope==='campaign'?'campaign_id':scope==='provider'?'provider':null;
  return field?sql`${sql.identifier(alias)}.${sql.identifier(field)} = ${id}`:sql`true`;
}
export async function evaluateAlerts(store:MonitoringStore,now=new Date()){
  const database=store.database(),allRules=await database.select().from(rules).where(and(eq(rules.workspaceId,workspace),eq(rules.enabled,true)));
  for(const rule of allRules){
    const w:Window={start:new Date(now.getTime()-rule.windowMinutes*60000).toISOString(),end:now.toISOString(),timezone:'UTC'};
    const metric=await evaluateMetric(store,rule.metric,w,rule.scope,rule.scopeId,rule.currency);
    await transitionAlert(store,`rule:${rule.id}`,rule.id,rule.name,rule.severity,metric.value,metric.samples,thresholdExceeded(metric.value,rule.threshold,metric.samples,rule.minSamples),rule.cooldownMinutes,now);
  }
  for(const budget of await database.select().from(budgets).where(eq(budgets.workspaceId,workspace))){
    const start=new Date(now);start.setUTCHours(0,0,0,0);if(budget.period==='month')start.setUTCDate(1);
    const w={start:start.toISOString(),end:now.toISOString(),timezone:'UTC'},metric=await evaluateMetric(store,'spend',w,budget.scope,budget.scopeId,budget.currency),limit=fixed(budget.limit);
    const percent=limit>BigInt(0)?fixed(metric.value)*BigInt(100)*SCALE/limit:fixed(metric.value)>BigInt(0)?BigInt(100)*SCALE:BigInt(0);
    await transitionAlert(store,`budget:${budget.id}:${w.start}`,null,budget.name,percent>=BigInt(budget.criticalPercent)*SCALE?'critical':'warning',`${metric.value} ${budget.currency}; ${money(percent)}%`,metric.samples,percent>=BigInt(budget.warningPercent)*SCALE,30,now);
  }
}
async function evaluateMetric(store:MonitoringStore,metric:string,w:Window,scope:string,scopeId:string,currency:string){
  if(metric==='spend'){const data=await costs(store,w,scopeSql(scope,scopeId,'u')),total=data.totals.find(t=>t.currency===currency);return {value:total?.estimated||'0',samples:total?Math.max(1,total.pending):0};}
  if(metric==='tokens'){
    const [row]=await query<{value:string;samples:number}>(store,sql`select coalesce(sum(quantity),0)::text value,count(distinct resource_id)::int samples from usage_measurements u where workspace_id=${workspace} and period_start>=${w.start}::timestamptz and period_start<${w.end}::timestamptz and service like 'llm_%' and ${scopeSql(scope,scopeId,'u')}`);return row;
  }
  if(metric==='llm_failure_rate'||metric==='llm_rate_limits'){
    const field=scope==='agent'?'agentId':scope==='campaign'?'campaignId':scope==='provider'?'provider':null,scoped=field?sql`event->>${field}=${scopeId}`:sql`true`;
    const [r]=await query<{value:string;samples:number}>(store,sql`select ${metric==='llm_rate_limits'?sql`count(*) filter(where event->'data'->>'httpStatus'='429')`:sql`coalesce(count(*) filter(where event->'data'->>'usageIncomplete'='true')::numeric/nullif(count(*),0),0)`}::text value,count(*)::int samples from monitoring_events where workspace_id=${workspace} and category='LLM' and event->'data'->>'service'='llm_input' and occurred_at>=${w.start}::timestamptz and occurred_at<${w.end}::timestamptz and ${scoped}`);return r;
  }
  if(metric==='queue_backlog'){const [r]=await query<{value:string;samples:number}>(store,sql`select count(*)::text value,count(*)::int samples from monitoring_events where workspace_id=${workspace} and processed_at is null`);return r;}
  if(metric==='reconciliation_failures'){const [r]=await query<{value:string;samples:number}>(store,sql`select coalesce(sum(errors),0)::text value,count(*)::int samples from billing_reconciliation_runs where workspace_id=${workspace} and started_at>=${w.start}::timestamptz and started_at<${w.end}::timestamptz`);return r;}
  if(['tool_failures','websocket_disconnects','webhook_failures','latency_ms'].includes(metric)){
    const type=metric==='tool_failures'?'ai.tool.executed':metric==='websocket_disconnects'?'system.websocket.disconnected':metric==='webhook_failures'?'system.webhook.failed':'ai.turn.completed';
    const field=scope==='agent'?'agentId':scope==='campaign'?'campaignId':scope==='provider'?'provider':null;
    const scoped=field?sql`event->>${field}=${scopeId}`:sql`true`;
    const [r]=await query<{value:string;samples:number}>(store,sql`select ${metric==='latency_ms'?sql`coalesce(avg((event->'data'->>'latencyMs')::numeric),0)` :sql`count(*) filter(where ${metric==='tool_failures'?sql`event->>'status'='failed'`:sql`true`})`}::text value,count(*)::int samples from monitoring_events where workspace_id=${workspace} and event->>'type'=${type} and occurred_at>=${w.start}::timestamptz and occurred_at<${w.end}::timestamptz and ${scoped}`);return r;
  }
  const [r]=await query<{value:string;samples:number}>(store,sql`select ${metric==='failure_rate'?sql`coalesce(count(*) filter(where status in ('failed','undelivered'))::numeric/nullif(count(*),0),0)` :metric==='no_answer_rate'?sql`coalesce(count(*) filter(where status='no-answer')::numeric/nullif(count(*),0),0)` :metric==='duration_seconds'?sql`coalesce(max(duration_seconds),0)` :metric==='segments'?sql`coalesce(sum(segments),0)`:sql`count(*)`}::text value,count(*)::int samples from monitoring_resources r where workspace_id=${workspace} and category in ('VOICE','MESSAGING') and started_at>=${w.start}::timestamptz and started_at<${w.end}::timestamptz and ${scopeSql(scope,scopeId)}`);return r;
}
async function transitionAlert(store:MonitoringStore,key:string,ruleId:string|null,name:string,severity:string,value:string,samples:number,triggered:boolean,cooldown:number,now:Date){
  const database=store.database(),[previous]=await database.select().from(alerts).where(eq(alerts.key,key));
  if(!triggered){if(previous?.state==='active')await database.update(alerts).set({state:'resolved',resolvedAt:now.toISOString(),value,samples}).where(eq(alerts.id,previous.id));return;}
  if(previous?.state==='resolved'&&now.getTime()-Date.parse(previous.resolvedAt||previous.lastSeenAt)<cooldown*60000)return;
  await database.insert(alerts).values({key,ruleId,name,severity,value,samples,detectedAt:now.toISOString(),lastSeenAt:now.toISOString()}).onConflictDoUpdate({target:alerts.key,set:{state:'active',severity,value,samples,lastSeenAt:now.toISOString(),resolvedAt:null,...(previous?.state==='resolved'?{detectedAt:now.toISOString(),acknowledgedAt:null}:{})}});
}
