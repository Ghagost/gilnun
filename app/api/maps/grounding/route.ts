import { handleGrounding } from '@/lib/server/grounding';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function POST(req: Request) {
  return handleGrounding(req);
}
