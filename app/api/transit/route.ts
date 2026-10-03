import { handleTransit } from '@/lib/server/navitime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return handleTransit(req);
}
