import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFile } from 'node:fs/promises';
import twilio from 'twilio';
import type { WebSocket } from 'ws';
import type { db } from '../src/db';
import * as schema from '../src/db/schema';
import { PostgresStore, newSession } from '../src/lib/ai/store';
import { fixture } from './helpers';
import { handleRelaySocket, validRelayHandshake } from '../src/lib/ai/gateway';
import { productionAiIssues } from '../src/lib/ai/deployment';
import { GET as relayGet } from '../src/app/api/twilio/ai/relay/route';
import { GET as healthGet } from '../src/app/api/twilio/ai/health/route';

test('a persisted atomic socket owner prevents two gateway instances from handling the same call',async()=>{
  const pg=new PGlite();try{
    await pg.exec(await readFile('drizzle/0000_luxuriant_thunderbolts.sql','utf8'));await pg.exec(await readFile('drizzle/0001_yellow_bromley.sql','utf8'));
    const store=new PostgresStore(()=>drizzle(pg,{schema}) as unknown as ReturnType<typeof db>),agent=(await store.agents())[0],lead=await store.leadByPhone('+14155550143'),session=newSession(agent,lead,'inbound');
    await store.createSession(session);
    const claimed=await Promise.all([store.claimRelay(session.id,'worker-a'),store.claimRelay(session.id,'worker-b')]);
    assert.equal(claimed.filter(Boolean).length,1);assert.ok((await store.session(session.id))?.memory.relayOwner);
    await store.patchSession(session.id,{endedAt:new Date().toISOString()});assert.equal(await store.claimRelay(session.id,'worker-c'),false);
  }finally{await pg.close();}
});
test('Vercel sessions cap call length below function duration without changing the agent profile',async()=>{
  const previous=process.env.AI_GATEWAY_MODE;
  try{process.env.AI_GATEWAY_MODE='vercel';const f=await fixture();f.agent.config.maxDurationSeconds=600;const session=newSession(f.agent,f.lead,'outbound');assert.equal(session.agentSnapshot.maxDurationSeconds,240);assert.equal(f.agent.config.maxDurationSeconds,600);}
  finally{if(previous===undefined)delete process.env.AI_GATEWAY_MODE;else process.env.AI_GATEWAY_MODE=previous;}
});
test('Vercel mode requires its exact signed application relay path',()=>{
  const env={AI_DEPLOYMENT_MODE:'production',AI_GATEWAY_MODE:'vercel',APP_URL:'https://clarity.company.com',AI_WEBSOCKET_PUBLIC_URL:'wss://other.company.com/relay'};
  assert.ok(productionAiIssues(env).some(e=>e.startsWith('AI_WEBSOCKET_PUBLIC_URL')));
  assert.deepEqual(productionAiIssues({...env,AI_WEBSOCKET_PUBLIC_URL:'wss://clarity.company.com/api/twilio/ai/relay'}),[]);
  process.env.AI_WEBSOCKET_PUBLIC_URL='wss://clarity.company.com/api/twilio/ai/relay';process.env.TWILIO_AUTH_TOKEN='gateway-test-only';
  const signature=twilio.getExpectedTwilioSignature('gateway-test-only',process.env.AI_WEBSOCKET_PUBLIC_URL,{});
  assert.equal(validRelayHandshake(signature,'/api/twilio/ai/relay'),true);assert.equal(validRelayHandshake(signature,'/relay'),false);assert.equal(validRelayHandshake('invalid','/api/twilio/ai/relay'),false);
});
test('socket input rejects malformed frames and completes cleanup on close',async()=>{
  const f=await fixture();const socket=new EventEmitter() as EventEmitter & {close:(code:number)=>void;readyState:number};let code=0;
  socket.readyState=1;socket.close=n=>{code=n;socket.emit('close');};
  const connection=handleRelaySocket(socket as unknown as WebSocket,f.store);
  socket.emit('message',Buffer.from('{"type":"unexpected"}'));await connection.done;
  assert.equal(code,1008);assert.equal((await f.store.messages(f.session.id)).length,0);
});
test('Vercel relay and health reject unauthenticated requests without opening a socket or exposing settings',async()=>{
  process.env.AI_GATEWAY_MODE='vercel';process.env.AI_VOICE_ENABLED='1';process.env.DEMO_MODE='0';
  const relay=await relayGet(new Request('https://clarity.company.com/api/twilio/ai/relay'));
  assert.equal(relay.status,403);
  assert.equal((await healthGet(new Request('https://clarity.company.com/api/twilio/ai/health'))).status,404);
});
