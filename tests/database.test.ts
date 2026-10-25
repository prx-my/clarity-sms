import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultAgent } from '../src/lib/ai/config';
import { PostgresStore, newSession, usageEvent } from '../src/lib/ai/store';
import { applyStatus } from '../src/lib/ai/telephony';
import { drizzle } from 'drizzle-orm/pglite';
import type { db } from '../src/db';
import * as schema from '../src/db/schema';

test('generated migrations preserve SMS, enforce call reservations and persist transcripts across reopen',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'clarity-ai-db-'));let pg=new PGlite(directory);
  try{
    await pg.exec(await readFile('drizzle/0000_luxuriant_thunderbolts.sql','utf8'));
    const contact=crypto.randomUUID(),agent=crypto.randomUUID(),session=crypto.randomUUID(),thread=crypto.randomUUID();
    await pg.query('insert into contacts(id,phone,name) values ($1,$2,$3)',[contact,'+14155550143','Existing contact']);
    await pg.query('insert into conversations(id,contact_id,twilio_number) values ($1,$2,$3)',[thread,contact,'+14155550199']);
    await pg.query("insert into messages(conversation_id,direction,body,from_number,to_number) values($1,'outbound','Existing SMS',$2,$3)",[thread,'+14155550199','+14155550143']);
    await pg.exec(await readFile('drizzle/0001_yellow_bromley.sql','utf8'));await pg.exec(await readFile('drizzle/0002_yellow_bucky.sql','utf8'));
    const config=JSON.stringify(defaultAgent());await pg.query('insert into ai_agents(id,config) values ($1,$2)',[agent,config]);
    await pg.query("insert into ai_call_sessions(id,agent_id,contact_id,direction,phone,agent_snapshot) values($1,$2,$3,'outbound',$4,$5)",[session,agent,contact,'+14155550143',config]);
    await assert.rejects(()=>pg.query("insert into ai_call_sessions(agent_id,contact_id,direction,phone,agent_snapshot) values($1,$2,'outbound',$3,$4)",[agent,contact,'+14155550143',config]),/duplicate key/);
    await pg.query("insert into ai_conversation_messages(session_id,role,text,delivery) values($1,'user','Real stored transcript','received')",[session]);
    await pg.query("insert into ai_tool_executions(session_id,name,key,input,status) values($1,'send_demo_link','once','{}','pending')",[session]);
    await assert.rejects(()=>pg.query("insert into ai_tool_executions(session_id,name,key,input,status) values($1,'send_demo_link','once','{}','pending')",[session]),/duplicate key/);
    await assert.rejects(()=>pg.query("insert into ai_conversation_messages(session_id,role,text,delivery) values($1,'user','bad','received')",[crypto.randomUUID()]),/foreign key/);
    await pg.close();pg=new PGlite(directory);
    assert.equal((await pg.query<{body:string}>('select body from messages')).rows[0].body,'Existing SMS');
    assert.equal((await pg.query<{text:string}>('select text from ai_conversation_messages')).rows[0].text,'Real stored transcript');
    await pg.query("update ai_call_sessions set ended_at=now(),state='COMPLETED' where id=$1",[session]);
    await pg.query("insert into ai_call_sessions(agent_id,contact_id,direction,phone,agent_snapshot) values($1,$2,'outbound',$3,$4)",[agent,contact,'+14155550143',config]);
    await pg.query('delete from ai_call_sessions where id=$1',[session]);
    assert.equal((await pg.query('select * from ai_conversation_messages')).rows.length,0);
    assert.equal((await pg.query('select * from messages')).rows.length,1);
  }finally{await pg.close();await rm(directory,{recursive:true,force:true});}
});

test('PostgresStore SQL supports the real session lifecycle, concurrent status ordering, usage and retention',async()=>{
  const pg=new PGlite();try{
    await pg.exec(await readFile('drizzle/0000_luxuriant_thunderbolts.sql','utf8'));await pg.exec(await readFile('drizzle/0001_yellow_bromley.sql','utf8'));await pg.exec(await readFile('drizzle/0002_yellow_bucky.sql','utf8'));
    const store=new PostgresStore(()=>drizzle(pg,{schema}) as unknown as ReturnType<typeof db>);
    const agent=(await store.agents())[0],lead=await store.leadByPhone('+14155550143'),session=newSession(agent,lead,'inbound',true);
    session.callSid='CA'+'a'.repeat(32);await store.createSession(session);await store.addMessage({id:crypto.randomUUID(),sessionId:session.id,role:'user',text:'Please help with a website',generatedText:null,interrupted:false,delivery:'received',createdAt:new Date().toISOString()});
    await store.saveLead({...lead,consentAt:new Date().toISOString(),consentEvidence:'Explicit test consent',optedOut:true});await store.saveLead({...lead,name:'Caller'});assert.equal((await store.lead(lead.id))?.optedOut,true);
    assert.equal((await store.getLeads()).find(l=>l.id===lead.id)?.optedOut,true);
    const tool={id:crypto.randomUUID(),sessionId:session.id,name:'lookup_lead',key:'one',input:{},output:null,status:'pending' as const,durationMs:0,createdAt:new Date().toISOString()};
    const claims=await Promise.all([store.claimTool(tool),store.claimTool({...tool,id:crypto.randomUUID()})]);assert.equal(claims.filter(Boolean).length,1);await store.finishTool(tool.id,{status:'succeeded',output:{ok:true,code:'found'}});
    process.env.TWILIO_ACCOUNT_SID='AC'+'b'.repeat(32);const p={AccountSid:process.env.TWILIO_ACCOUNT_SID,CallSid:session.callSid,CallDuration:'61'};
    await Promise.all([applyStatus(store,session.id,{...p,CallStatus:'completed'}),applyStatus(store,session.id,{...p,CallStatus:'ringing'})]);assert.equal((await store.session(session.id))?.connectionStatus,'completed');
    const actual=usageEvent(session.id,'voice_duration','twilio_inbound','61','second','US',{source:'Twilio price'});actual.finalizedUsd='0.02';actual.estimated=false;await store.recordUsage(actual);await store.recordUsage(usageEvent(session.id,'voice_duration','twilio_inbound','70','second','US'));assert.equal((await store.usage(session.id))[0].finalizedUsd,'0.02');
    await store.event(session.id,'test_event');await store.patchSession(session.id,{endedAt:'2020-01-01T00:00:00.000Z',summary:'Private summary',memory:{private:'Private fact'}});await store.prune('2026-01-01T00:00:00.000Z');assert.equal((await store.messages(session.id)).length,0);assert.equal((await store.tools(session.id)).length,0);assert.equal((await store.events(session.id)).length,0);assert.equal((await store.usage(session.id)).length,1);assert.deepEqual((await store.session(session.id))?.memory,{});
  }finally{await pg.close();}
});
