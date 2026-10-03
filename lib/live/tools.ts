import type { AgentTool, ToolContext } from '../ai/agent';
import { buildTools } from '../ai/tools';
import { angDelta, bearing, dirKo, distance, relDirKo, walkMinutes } from '../geo';
import { geo } from '../store/geo';
import { places } from '../store/places';
import type { Source } from '../types';

const KEEP = new Set(['search_places', 'place_details', 'set_destination', 'get_directions', 'get_weather', 'show_to_staff']);

/** Fresh position, heading and destination bearing — the live model can't see the GPS on its own. */
export function whereAmI(): Record<string, unknown> {
  const g = geo();
  const d = places().dest;
  const out: Record<string, unknown> = {};
  if (g.me) {
    out.lat = Number(g.me.lat.toFixed(5));
    out.lng = Number(g.me.lng.toFixed(5));
    out.gps_accuracy_m = Math.round(g.me.acc);
    out.gps_age_s = Math.round((Date.now() - g.me.t) / 1000);
    if (g.area?.label) out.area = g.area.label;
  } else out.location = '모름 (GPS 신호 없음)';
  if (g.heading != null) out.phone_facing = `${dirKo(g.heading)} (${Math.round(g.heading)}°)`;
  if (d) {
    out.destination = d.nameLocal && d.nameLocal !== d.name ? `${d.name} (${d.nameLocal})` : d.name;
    if (g.me) {
      const m = distance(g.me, d);
      const b = bearing(g.me, d);
      out.straight_distance_m = Math.round(m);
      out.walk_min = walkMinutes(m);
      out.destination_direction = `${dirKo(b)} (${Math.round(b)}°)`;
      if (g.heading != null) out.destination_on_screen = relDirKo(angDelta(g.heading, b));
    }
  } else out.destination = null;
  if (g.me && g.me.acc > 40) out.note = 'GPS 오차가 커. 실내·지하라면 표지판을 우선해.';
  return out;
}

export function liveTools(): AgentTool[] {
  return [
    {
      name: 'where_am_i',
      description: '지금 내 위치(GPS), 휴대폰이 향한 방향, 목적지까지 거리와 방향(화면 기준 정면/왼쪽/오른쪽)을 알려줘. 길을 안내하기 전에 불러.',
      parameters: { type: 'object', properties: {} },
      run: async () => whereAmI(),
    },
    ...buildTools().filter(t => KEEP.has(t.name)),
  ];
}

/** Keeps tool results small enough for a voice model's context. */
export function compactOutput(v: unknown): Record<string, unknown> {
  let o: Record<string, unknown> = v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : { result: v ?? 'ok' };
  if (typeof o.grounded_text === 'string') o.grounded_text = o.grounded_text.slice(0, 1800);
  for (const k of ['results', 'places', 'routes', 'hours', 'days', 'weekly_hours']) {
    if (Array.isArray(o[k])) o[k] = (o[k] as unknown[]).slice(0, k === 'routes' ? 2 : 6);
  }
  const s = JSON.stringify(o);
  if (s.length > 6000) o = { summary: s.slice(0, 6000) };
  return o;
}

export async function runLiveTool(tools: AgentTool[], name: string, args: unknown, h: { step: (s: string) => void; sources: (s: Source[]) => void }, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const t = tools.find(x => x.name === name);
  if (!t) return { error: `unknown tool: ${name}` };
  const ctx: ToolContext = { signal, step: h.step, pinned: [], mapsSources: [], sources: [], fresh: name === 'search_places' };
  try {
    const out = await t.run(args && typeof args === 'object' ? (args as Record<string, unknown>) : {}, ctx);
    if (ctx.mapsSources.length) h.sources(ctx.mapsSources);
    return compactOutput(out);
  } catch (e) {
    return { error: String((e as Error)?.message || e).slice(0, 240) };
  }
}
