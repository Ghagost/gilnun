import { handleAiProxy } from '@/lib/server/aiProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request, ctx: { params: Promise<{ provider: string; path: string[] }> }) {
  const { provider, path } = await ctx.params;
  return handleAiProxy(req, provider, path || []);
}
