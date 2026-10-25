import test from 'node:test';
import assert from 'node:assert/strict';
import { getStore, MemoryStore } from '../src/lib/ai/store';
import { demoStore } from '../src/lib/demo';
test('preview AI consent uses the existing preview contacts and never a live database store',async()=>{
  process.env.DEMO_MODE='1';const store=getStore();assert.ok(store instanceof MemoryStore);
  const contact=demoStore().contacts[0],lead=await store.lead(contact.id);assert.equal(lead?.phone,contact.phone);
  await store.saveLead({...lead!,consentAt:new Date().toISOString(),consentEvidence:'Preview-only permission evidence'});
  assert.equal((await getStore().lead(contact.id))?.consentEvidence,'Preview-only permission evidence');
  assert.equal((await store.sessions()).length,0);
});
