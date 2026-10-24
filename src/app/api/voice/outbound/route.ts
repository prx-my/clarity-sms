import twilio from 'twilio';
import { normalizePhone } from '@/lib/phone';
import { twilioNumber, validateWebhook } from '@/lib/twilio';

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
  response.dial({ callerId: twilioNumber(), timeout: 30 }).number(to);
  return new Response(response.toString(), {
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
