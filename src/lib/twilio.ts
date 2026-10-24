import twilio from 'twilio';
import { normalizePhone } from './phone';
export function client() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Twilio credentials are missing');
  return twilio(sid, token);
}
export function twilioNumber() {
  const number = normalizePhone(process.env.TWILIO_PHONE_NUMBER || '');
  if (!number) throw new Error('TWILIO_PHONE_NUMBER must be a valid E.164 number');
  return number;
}
export function publicAppUrl() {
  const value = process.env.APP_URL;
  if (!value) throw new Error('APP_URL is missing');
  return value.replace(/\/$/, '');
}
export function validateWebhook(request: Request, params: Record<string,string>) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const signature = request.headers.get('x-twilio-signature');
  if (!token || !signature) return false;
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || new URL(request.url).protocol.replace(':','');
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host');
  if (!host) return false;
  const parsed = new URL(request.url);
  const exactUrl = `${proto}://${host}${parsed.pathname}${parsed.search}`;
  return twilio.validateRequest(token, signature, exactUrl, params);
}
export { errorReasons, errorReason } from './errors';
