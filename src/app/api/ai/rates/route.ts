import { z } from 'zod';
import { aiAuth, aiError } from '@/lib/ai/http';
import { getStore } from '@/lib/ai/store';
export const runtime='nodejs';
const rateSchema=z.object({provider:z.string().min(1).max(100),category:z.enum(['twilio_inbound','twilio_outbound','twilio_transfer','conversation_relay','stt','tts','llm_input','llm_cached_input','llm_cache_write','llm_output','sms','recording','other']),model:z.string().max(150),unit:z.enum(['minute','second','token','message','character','request']),usdPerUnit:z.string().regex(/^\d+(\.\d{1,12})?$/),effectiveAt:z.iso.datetime(),source:z.url(),bundled:z.boolean(),increment:z.number().int().min(1).max(60)}).strict();
export async function POST(request:Request){const denied=await aiAuth(request);if(denied)return denied;try{const rate=rateSchema.parse(await request.json());await getStore().addRate({id:crypto.randomUUID(),...rate});return Response.json({ok:true});}catch(e){return aiError(e);}}
