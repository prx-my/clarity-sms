import { authorized, errorResponse, unauthorized } from '@/lib/api';
import { client, twilioNumber } from '@/lib/twilio';

export const runtime = 'nodejs';

export async function GET() {
  if (!await authorized()) return unauthorized();
  if (process.env.DEMO_MODE === '1') return Response.json({ items: [] });

  try {
    const calls = await client().calls.list({ from: twilioNumber(), limit: 30 });
    return Response.json({
      items: calls.map(call => ({
        sid: call.sid,
        to: call.to,
        status: call.status,
        duration: Number(call.duration || 0),
        createdAt: call.dateCreated?.toISOString() || null,
      })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
