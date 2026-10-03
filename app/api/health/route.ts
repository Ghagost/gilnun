export const dynamic = 'force-dynamic';

export function GET() {
  // `app` lets the start script recognise an already running copy of 길눈 on the same port.
  return Response.json({ ok: true, app: 'gilnun', at: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
}
