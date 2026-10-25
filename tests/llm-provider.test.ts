import test from 'node:test';
import assert from 'node:assert/strict';
import { llmConnection } from '../src/lib/ai/llm-connection';
import { requiredConfiguration } from '../src/lib/ai/config';
import { estimate } from '../src/lib/ai/cost';
import { usageEvent } from '../src/lib/ai/store';
test('provider selection keeps Groq and OpenAI credentials and API hosts separate',()=>{
  process.env.GROQ_API_KEY='groq-test-only';process.env.OPENAI_API_KEY='openai-test-only';
  assert.equal(llmConnection('groq').baseURL,'https://api.groq.com/openai/v1');assert.equal(llmConnection('groq').apiKey,'groq-test-only');
  assert.equal(llmConnection('openai').baseURL,'https://api.openai.com/v1');assert.equal(llmConnection('openai').apiKey,'openai-test-only');
  delete process.env.OPENAI_API_KEY;assert.ok(!requiredConfiguration('groq').includes('OPENAI_API_KEY'));
});
test('small cached-token rate cards retain precision below one nanodollar per rate fraction',()=>{
  const usage=usageEvent('s','u','llm_cached_input','200','token','openai/gpt-oss-20b');
  const cost=estimate([usage],[{id:'groq-cached',provider:'Groq',category:'llm_cached_input',model:usage.model,unit:'token',usdPerUnit:'0.0000000375',effectiveAt:'2020-01-01T00:00:00.000Z',source:'https://console.groq.com/docs/prompt-caching',bundled:false,increment:1}]);
  assert.equal(cost.totalEstimatedUsd,'0.000007500');assert.equal(cost.complete,true);
});
