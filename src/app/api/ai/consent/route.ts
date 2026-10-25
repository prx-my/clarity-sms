import { z } from 'zod';
import { aiAuth, aiError } from '@/lib/ai/http';
import { getStore } from '@/lib/ai/store';
export const runtime='nodejs';
const schema=z.object({contactId:z.uuid(),evidence:z.string().trim().min(15).max(1000),timezone:z.string().refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}},'Use an IANA timezone'),confirmed:z.literal(true)}).strict();
export async function POST(request:Request){const denied=await aiAuth(request);if(denied)return denied;
  try{const data=schema.parse(await request.json()),store=getStore(),lead=await store.lead(data.contactId);if(!lead)return Response.json({error:'Contact not found'},{status:404});if(lead.optedOut)return Response.json({error:'Contact has opted out; consent cannot clear suppression'},{status:403});
    lead.consentAt=new Date().toISOString();lead.consentEvidence=data.evidence;lead.timezone=data.timezone;await store.saveLead(lead);return Response.json({ok:true,consentAt:lead.consentAt});
  }catch(e){return aiError(e);}}
