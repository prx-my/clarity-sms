import { NextRequest, NextResponse } from 'next/server';
import { cookieName, validSession } from './lib/session';
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === '/login' || path === '/api/auth/login' || path.startsWith('/api/twilio/')) return NextResponse.next();
  if (await validSession(request.cookies.get(cookieName)?.value)) return NextResponse.next();
  if (path.startsWith('/api/')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.redirect(new URL('/login', request.url));
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
