import { handleQuake } from '@/lib/server/info';

export const dynamic = 'force-dynamic';

export function GET() {
  return handleQuake();
}
