import { handleWeather } from '@/lib/server/info';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return handleWeather(req);
}
