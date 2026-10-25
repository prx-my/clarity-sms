import test from 'node:test';
import assert from 'node:assert/strict';
import twilio from 'twilio';
import { POST } from '../src/app/api/voice/outbound/route';
process.env.TWILIO_AUTH_TOKEN='manual-test-token';process.env.TWILIO_PHONE_NUMBER='+14155550199';process.env.AI_VOICE_ENABLED='0';
test('manual dialer still returns its existing Dial TwiML while AI is disabled',async()=>{const url='https://manual.example.com/api/voice/outbound',params={To:'+14155550143'},signature=twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN!,url,params);const request=new Request(url,{method:'POST',headers:{'x-twilio-signature':signature,host:'manual.example.com','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)});const response=await POST(request);assert.equal(response.status,200);const xml=await response.text();assert.match(xml,/<Dial/);assert.match(xml,/<Number>\+14155550143<\/Number>/);assert.ok(!xml.includes('ConversationRelay'));});
test('manual dialer continues rejecting unsigned requests',async()=>{const response=await POST(new Request('https://manual.example.com/api/voice/outbound',{method:'POST',body:new URLSearchParams({To:'+14155550143'})}));assert.equal(response.status,403);});
