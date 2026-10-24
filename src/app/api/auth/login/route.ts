import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession, cookieName } from '@/lib/session';
import { timingSafeEqual } from 'node:crypto';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const parsed = z.object({ password: z.string().min(1) }).safeParse(await request.json().catch(() => null));
  const actual = process.env.ADMIN_PASSWORD;
  if (!parsed.success || !actual) return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  const a = Buffer.from(parsed.data.password), b = Buffer.from(actual);
  if (a.length !== b.length || !timingSafeEqual(a,b)) return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookieName, await createSession(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60*60*24*7 });
  return response;
}
