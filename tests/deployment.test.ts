import test from 'node:test';
import assert from 'node:assert/strict';
import { productionAiIssues, productionEnvironmentReport, publicUrlIssue } from '../src/lib/ai/deployment';
import { aiEnabled } from '../src/lib/ai/config';
import { readiness } from '../src/lib/ai/readiness';

const base = { DATABASE_URL: 'test-only', TWILIO_ACCOUNT_SID: 'test-only', TWILIO_AUTH_TOKEN: 'test-only', TWILIO_PHONE_NUMBER: 'test-only', TWILIO_API_KEY_SID: 'test-only', TWILIO_API_KEY_SECRET: 'test-only', TWILIO_TWIML_APP_SID: 'test-only', ADMIN_PASSWORD: 'test-only', SESSION_SECRET: 'x'.repeat(32), APP_URL: 'https://clarity.company.com' };
test('production permits the existing dialer with AI disabled and requires no LLM key', () => {
  const result = productionEnvironmentReport(base);
  assert.equal(result.ready, true); assert.equal(result.aiEnabled, false);
});
test('production AI rejects demo tunnels, local proxying and missing provider credentials', () => {
  const result = productionEnvironmentReport({ ...base, AI_VOICE_ENABLED: '1', AI_LLM_PROVIDER: 'groq', AI_WEBSOCKET_PUBLIC_URL: 'wss://demo.ngrok-free.dev/relay', AI_PROXY_APP_URL: 'http://127.0.0.1:3100' });
  assert.equal(result.ready, false);
  for (const key of ['AI_WEBSOCKET_PUBLIC_URL', 'AI_PROXY_APP_URL', 'GROQ_API_KEY', 'AI_GATEWAY_SECRET', 'AI_CONVERSATION_RELAY_ACKNOWLEDGED']) assert.ok(result.errors.some(x => x.startsWith(key)));
  assert.ok(!JSON.stringify(result).includes('127.0.0.1'));
});
test('stable production URLs and Groq credential configuration pass without an OpenAI key', () => {
  const result = productionEnvironmentReport({ ...base, AI_VOICE_ENABLED: '1', AI_LLM_PROVIDER: 'groq', GROQ_API_KEY: 'secret-not-displayed', AI_WEBSOCKET_PUBLIC_URL: 'wss://voice.company.com/relay', AI_GATEWAY_SECRET: 'x'.repeat(32), AI_CONVERSATION_RELAY_ACKNOWLEDGED: '1' });
  assert.equal(result.ready, true); assert.ok(!JSON.stringify(result).includes('secret-not-displayed'));
});
test('production rejects credentials, query secrets, private and placeholder URL hosts', () => {
  for (const url of ['https://user:password@service.company.com', 'https://service.company.com?token=secret', 'https://127.0.0.1', 'https://192.168.1.2', 'https://[::1]', 'https://service.internal', 'https://your-gateway.example.com']) assert.ok(publicUrlIssue(url, 'https:'), url);
  assert.deepEqual(productionAiIssues({ AI_WEBSOCKET_PUBLIC_URL: 'wss://demo.ngrok-free.dev/relay' }), []);
});
test('production runtime fails closed on local demo configuration, while ordinary local testing still works', () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { VERCEL_ENV: 'production', AI_VOICE_ENABLED: '1', DEMO_MODE: '0', APP_URL: 'https://clarity.company.com', AI_WEBSOCKET_PUBLIC_URL: 'wss://demo.ngrok-free.dev/relay' });
    assert.equal(aiEnabled(), false);
    delete process.env.VERCEL_ENV; delete process.env.AI_DEPLOYMENT_MODE;
    assert.equal(aiEnabled(), true);
  } finally { process.env = saved; }
});
test('unverified configuration is never reported as live provider readiness', async () => {
  assert.equal((await readiness(false)).liveReady, false);
});
