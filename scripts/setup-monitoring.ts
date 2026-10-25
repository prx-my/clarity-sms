import dotenv from 'dotenv';
dotenv.config({path:'.env.local',quiet:true});dotenv.config({quiet:true});
import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';
async function main(){
  const apply=process.argv.includes('--apply');if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
  const sql=neon(process.env.DATABASE_URL);
  const rows=await sql`select table_name from information_schema.tables where table_schema='public'`;
  const existing=new Set(rows.map(r=>String(r.table_name)));
  const required=['contacts','conversations','messages','message_events','webhook_logs','ai_call_usage'];if(required.some(t=>!existing.has(t)))throw new Error('Apply the original application and AI migrations first');
  const expected=['monitoring_events','monitoring_resources','usage_measurements','cost_ledger_entries','provider_rate_cards','billing_adjustments','billing_reconciliation_runs','monitoring_sync_checkpoints','monitoring_alert_rules','monitoring_alert_instances','monitoring_budgets','monitoring_exchange_rates'];
  const found=expected.filter(t=>existing.has(t));
  const columns=await sql`select column_name from information_schema.columns where table_schema='public' and table_name='ai_call_usage' and column_name='updated_at'`;
  if(found.length===expected.length&&columns.length){console.log(JSON.stringify({state:'already_applied',tables:found.length}));return;}
  if(found.length||columns.length)throw new Error('Partial monitoring migration requires inspection; refusing automatic repair');
  if(!apply){console.log(JSON.stringify({state:'ready',existingApplicationPreserved:true,newTables:expected.length,alteredTables:['ai_call_usage.updated_at'],applyCommand:'npm run monitoring:setup -- --apply'}));return;}
  const source=await readFile('drizzle/0002_yellow_bucky.sql','utf8');
  await sql.transaction(source.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean).map(statement=>sql.query(statement,[])));
  console.log(JSON.stringify({state:'applied',tables:expected.length,existingApplicationPreserved:true}));
}
void main().catch(error=>{console.error('Monitoring migration unavailable',{kind:error?.name,code:error?.code||null});process.exitCode=1;});
