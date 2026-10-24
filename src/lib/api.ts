import { cookies } from 'next/headers';
import { cookieName, validSession } from './session';
export async function authorized() { return validSession((await cookies()).get(cookieName)?.value); }
export function unauthorized() { return Response.json({ error: 'Unauthorized' }, { status: 401 }); }
export function errorResponse(error: unknown) {
  console.error(error);
  return Response.json({ error: 'An unexpected server error occurred' }, { status: 500 });
}
