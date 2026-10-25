import { authorized, unauthorized } from '@/lib/api';
import { z } from 'zod';
export function originAllowed(request:Request) {
  const origin=request.headers.get('origin');if(!origin)return true;
  const parsed=new URL(request.url),host=request.headers.get('host');
  // Next may canonicalize a local request URL to localhost while retaining the
  // browser's actual 127.0.0.1 Host. Browsers cannot forge Host on cross-site fetches.
  return origin===parsed.origin||origin===process.env.APP_URL||!!host&&origin===`${parsed.protocol}//${host}`;
}
export async function aiAuth(request?:Request) {
  if(!await authorized())return unauthorized();
  if(request&&!['GET','HEAD'].includes(request.method)) {
    if(!originAllowed(request))return Response.json({error:'Invalid origin'},{status:403});
  }
  return null;
}
export function aiError(error:unknown) {
  if(error instanceof z.ZodError)return Response.json({error:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ').slice(0,1000)},{status:400});
  const code=typeof error==='object'&&error&&'code' in error?String(error.code):'';
  if(code==='23505')return Response.json({error:'An active AI demo call or duplicate action already exists. End or reconcile the previous call first.'},{status:409});
  // Log only exception class / database code, never SDK request headers, credentials or transcript bodies.
  console.error('AI operation failed',{kind:error instanceof Error?error.name:'Unknown',code});
  return Response.json({error:'AI operation unavailable. Check configuration and apply the AI database migration; inspect provider status in readiness.'},{status:503});
}
export const uuid=z.uuid();
