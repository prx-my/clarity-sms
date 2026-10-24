import twilio from 'twilio';
import { authorized, unauthorized } from '@/lib/api';

export const runtime = 'nodejs';

export async function POST() {
  if (!await authorized()) return unauthorized();
  if (process.env.DEMO_MODE === '1') {
    return Response.json({ error: 'Calls are unavailable in the demo workspace' }, { status: 403 });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const keySid = process.env.TWILIO_API_KEY_SID;
  const keySecret = process.env.TWILIO_API_KEY_SECRET;
  const appSid = process.env.TWILIO_TWIML_APP_SID;
  if (!accountSid || !keySid || !keySecret || !appSid) {
    return Response.json({ error: 'Voice calling is not configured yet' }, { status: 503 });
  }

  const token = new twilio.jwt.AccessToken(accountSid, keySid, keySecret, {
    identity: 'clarity-admin',
    ttl: 3600,
  });
  token.addGrant(new twilio.jwt.AccessToken.VoiceGrant({
    outgoingApplicationSid: appSid,
    incomingAllow: false,
  }));

  return Response.json({ token: token.toJwt() }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
