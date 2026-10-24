import { SignJWT, jwtVerify } from 'jose';
const cookieName = 'clarity_session';
export { cookieName };
function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return new TextEncoder().encode(secret);
}
export async function createSession() {
  return new SignJWT({ role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d').sign(key());
}
export async function validSession(value?: string) {
  if (!value) return false;
  try { const result = await jwtVerify(value, key()); return result.payload.role === 'admin'; } catch { return false; }
}
