import { fixture, message, signal } from '../tests/helpers';
import { buildContext } from '../src/lib/ai/context';
import { writeFile } from 'node:fs/promises';

// No environment loading, no network providers, no writes to the application's real DB.
async function main(){
const reports:Record<string,unknown>[]=[];
const a=await fixture();await a.runtime.start();await a.runtime.handle({type:'prompt',voicePrompt:'I have a roofing business and need a website redesign',last:true});
const caller=(await a.store.messages(a.session.id)).find(m=>m.role==='user')!;
await a.tools.execute(a.session.id,'update_lead',{fields:{industry:'roofing',problem:'website redesign'},evidenceMessageIds:[caller.id]},signal());
await a.tools.execute(a.session.id,'save_qualification',{outcome:'Meeting requested',summary:'Caller requested a website redesign consultation',evidenceMessageIds:[caller.id]},signal());
await a.tools.execute(a.session.id,'check_calendar_availability',{start:new Date(Date.now()+3600000).toISOString(),end:new Date(Date.now()+2*86400000).toISOString()},signal());
await a.store.addMessage(message(a.session.id,'assistant',`May I book ${a.slot.label}?`));const confirm=message(a.session.id,'user','Yes, please confirm that');await a.store.addMessage(confirm);
const booked=await a.tools.execute(a.session.id,'book_appointment',{slotId:a.slot.id,confirmationMessageId:confirm.id},signal());reports.push({scenario:'A: inquiry and booking',simulation:true,outcome:(await a.store.session(a.session.id))?.outcome,bookingResult:booked.code,provider:'injected test calendar, not a real booking'});
const b=await fixture();const sms=message(b.session.id,'user','Please text me the demo link');await b.store.addMessage(sms);const sent=await b.tools.execute(b.session.id,'send_demo_link',{confirmationMessageId:sms.id},signal());reports.push({scenario:'B: demo link',simulation:true,result:sent.code,provider:'injected test SMS, no real message sent'});
const c=await fixture(['We help build websites.']);await c.runtime.start();await c.runtime.handle({type:'prompt',voicePrompt:'What do you do?',last:true});await c.runtime.handle({type:'interrupt',utteranceUntilInterrupt:'We help',durationUntilInterruptMs:400});reports.push({scenario:'C: interruption',simulation:true,reportedPrefix:(await c.store.messages(c.session.id)).at(-1)?.text,audioQuality:'not measured'});
const d=await fixture();await d.runtime.start();await d.runtime.handle({type:'prompt',voicePrompt:"I'm not interested. Don't call again.",last:true});reports.push({scenario:'D: opt-out',simulation:true,suppressed:(await d.store.lead(d.lead.id))?.optedOut,state:(await d.store.session(d.session.id))?.state});
const e=await fixture();await e.runtime.start();await e.runtime.handle({type:'prompt',voicePrompt:'Can I speak to a real person?',last:true});reports.push({scenario:'E: transfer',simulation:true,attempts:e.effectsCount.transfer,provider:'injected test call control, no real transfer'});
const transcript=Array.from({length:80},(_,i)=>message(a.session.id,i%2?'assistant':'user',`Known conversational detail ${i}. `.repeat(8)));
const compact=buildContext(a.session,a.lead,transcript,[]);a.session.agentSnapshot.optimizations.compactContext=false;const baseline=buildContext(a.session,a.lead,transcript,[]);
const report={generatedAt:new Date().toISOString(),simulation:true,realCalls:0,scenarios:reports,contextComparison:{fixture:'80 synthetic messages',baselineCharacters:JSON.stringify(baseline).length,optimizedCharacters:JSON.stringify(compact).length,measurement:'serialized context characters, not tokens or observed provider savings'},limitations:['No real audio, speech recognition accuracy, transport latency, provider cost or business-quality savings measured.','All external effects use injected test providers.']};
await writeFile('docs/voice-simulation-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
