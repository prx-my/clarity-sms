import { aiEnabled, requiredConfiguration } from '@/lib/ai/config';
import { llmConnection } from '@/lib/ai/llm-connection';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  if(!process.env.AI_GATEWAY_SECRET||request.headers.get('x-ai-health')!==process.env.AI_GATEWAY_SECRET)return new Response(null,{status:404});
  return Response.json({ready:process.env.VERCEL==='1'&&process.env.AI_GATEWAY_MODE==='vercel'&&aiEnabled()&&!requiredConfiguration().length,provider:llmConnection().provider,transport:'vercel-websocket',maxCallSeconds:240},{headers:{'Cache-Control':'no-store'}});
}
