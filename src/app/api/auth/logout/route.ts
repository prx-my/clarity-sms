import { NextResponse } from 'next/server';
import { cookieName } from '@/lib/session';
export const runtime = 'nodejs';
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookieName, '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}
