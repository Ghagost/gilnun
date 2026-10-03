import { mintOpenAiRealtime } from '@/lib/server/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  return mintOpenAiRealtime(req);
}
