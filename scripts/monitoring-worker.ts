import dotenv from 'dotenv';
dotenv.config({path:'.env.local',quiet:true});dotenv.config({quiet:true});
import { MonitoringStore } from '../src/lib/monitoring/store';
import { tick, prune } from '../src/lib/monitoring/worker';
let stopped=false;process.on('SIGTERM',()=>{stopped=true;});process.on('SIGINT',()=>{stopped=true;});
async function main(){
  if(process.env.DEMO_MODE==='1')throw new Error('Monitoring worker requires real persistent storage, not preview mode');
  const store=new MonitoringStore();let lastBilling=0,lastRetention=0;
  do{try{const billing=Date.now()-lastBilling>300000;const result=await tick(store,billing);if(billing&&!result.locked)lastBilling=Date.now();if(Date.now()-lastRetention>86400000){await prune(store,Number(process.env.MONITORING_RETENTION_DAYS||90));lastRetention=Date.now();}}
    catch{console.error('Monitoring worker tick failed; durable events will be retried');}
    if(process.argv.includes('--once'))return;
    await new Promise(resolve=>setTimeout(resolve,15000));
  }while(!stopped);
}
void main().catch(()=>{console.error('Monitoring worker could not start. Check migrations and database configuration.');process.exitCode=1;});
