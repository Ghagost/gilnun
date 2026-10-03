import { handleFx } from '@/lib/server/info';

export const dynamic = 'force-dynamic';

export function GET() {
  return handleFx();
}
