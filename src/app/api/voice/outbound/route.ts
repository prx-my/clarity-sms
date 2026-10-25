import twilio from 'twilio';
import { normalizePhone } from '@/lib/phone';
import { publicAppUrl, twilioNumber, validateWebhook } from '@/lib/twilio';

import { collect } from '@/lib/monitoring/store';
import { voiceEvent } from '@/lib/monitoring/model';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const params = Object.fromEntries(await request.formData()) as Record<string, string>;
  if (!validateWebhook(request, params)) {
    return new Response('Invalid signature', { status: 403 });
  }

  const to = normalizePhone(params.To || '');
  if (!to || to === twilioNumber()) {
    return new Response('Invalid destination', { status: 400 });
  }

  const response = new twilio.twiml.VoiceResponse();
  const base = process.env.APP_URL ? publicAppUrl() : new URL(request.url).origin;
  response.dial({ callerId: twilioNumber(), timeout: 30, action: `${base}/api/twilio/monitoring/dial`, method: 'POST' }).number({ statusCallback: `${base}/api/twilio/monitoring/voice`, statusCallbackMethod: 'POST', statusCallbackEvent: ['initiated','ringing','answered','completed'] }, to);
  if (params.CallSid) try { await collect(voiceEvent({ ...params, CallStatus: 'in-progress' })); } catch { console.error('Monitoring parent leg could not be recorded'); }
  return new Response(response.toString(), {
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
