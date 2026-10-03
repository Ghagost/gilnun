'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FOOD_KINDS, category } from '@/lib/categories';
import { openPlace, runCategory, clearSearch } from '@/lib/actions';
import { distance, fmtDist, walkMinutes } from '@/lib/geo';
import { statusAt, statusLabel } from '@/lib/hours';
import { useGeo } from '@/lib/store/geo';
import { usePlaces } from '@/lib/store/places';
import { useRuntime } from '@/lib/store/runtime';
import { useSettings } from '@/lib/store/settings';
import { ui } from '@/lib/store/ui';
import type { PlaceSummary } from '@/lib/types';
import { I } from '../Icons';
import { Dots, Empty, ExtLink, PanelHead, Price, Stars } from '../ui';

type Sort = 'distance' | 'rating';

function Thumb({ p }: { p: PlaceSummary }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!p.photo || !ref.current) return;
    const el = ref.current;
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { setSrc(p.photo!.url(240) || null); io.disconnect(); }
    }, { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, [p.photo]);
  const C = category(p.category);
  return (
    <div ref={ref}>
      {src ? <img className="thumb" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setSrc(null)} />
        : <div className="thumb ph" style={{ color: C.color }}><I name={C.icon} className="lg" /></div>}
    </div>
  );
}

export function ResultRow({ p, onOpen, showThumb }: { p: PlaceSummary; onOpen: () => void; showThumb: boolean }) {
  const refOf = usePlaces(s => s.refOf[p.id]);
  const me = useGeo(s => s.me);
  const C = category(p.category);
  const st = p.hours ? statusLabel(statusAt(p.hours, new Date(), p.utcOffset ?? 540)) : null;
  const d = me ? distance(me, p) : p.distance;
  const closed = p.businessStatus === 'CLOSED_PERMANENTLY' || p.businessStatus === 'CLOSED_TEMPORARILY';
  const sub = [p.nameLocal, p.typeLabel || (p.info ? undefined : C.label), p.info].filter(Boolean).join(' · ');
  return (
    <li>
      <button className="result" onClick={onOpen}>
        <span className="t">
          <span className="name">
            <span className="badge" style={{ ['--c' as string]: C.color }}>{refOf?.slice(1)}</span>
            <b>{p.name}</b>
          </span>
          {sub && <span className="sub">{sub}</span>}
          <span className="meta">
            <Stars rating={p.rating} count={p.ratingCount} />
            <Price level={p.priceLevel} />
            {closed ? <span className="tone-closed">{p.businessStatus === 'CLOSED_PERMANENTLY' ? '폐업' : '임시 휴업'}</span>
              : st && st.tone !== 'unknown' && <span className={`tone-${st.tone}`}>{st.text}</span>}
            {d != null && <span className="dist">{fmtDist(d)} · 도보 {walkMinutes(d)}분</span>}
          </span>
        </span>
        {showThumb && <Thumb p={p} />}
      </button>
    </li>
  );
}

/** Credits every data source actually shown (a Google search can fall back to OpenStreetMap). */
export function attribution(sources: string[], engine: string | null): string {
  const s = new Set(sources);
  const parts = [s.has('google') || s.has('grounding') ? 'Google 지도 데이터' : '', s.has('osm') || s.has('geo') ? '© OpenStreetMap 기여자' : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : engine === 'google' ? 'Google 지도 데이터' : '© OpenStreetMap 기여자';
}

export default function ResultsPanel() {
  const results = usePlaces(s => s.results);
  const byId = usePlaces(s => s.byId);
  const engine = useRuntime(s => s.engine);
  const dataSaver = useSettings(s => s.dataSaver);
  const me = useGeo(s => s.me);
  const [openNow, setOpenNow] = useState(false);
  const [minRating, setMinRating] = useState(false);
  const [sort, setSort] = useState<Sort>('distance');

  const list = useMemo(() => {
    if (!results) return [];
    let ps = results.ids.map(id => byId[id]).filter(Boolean);
    if (openNow) ps = ps.filter(p => !p.hours || statusAt(p.hours, new Date(), p.utcOffset ?? 540)?.open !== false);
    if (minRating) ps = ps.filter(p => (p.rating ?? 0) >= 4);
    if (sort === 'rating') ps = [...ps].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.ratingCount ?? 0) - (a.ratingCount ?? 0));
    else if (me) ps = [...ps].sort((a, b) => distance(me, a) - distance(me, b));
    return ps;
  }, [results, byId, openNow, minRating, sort, me]);

  if (!results) return <Empty icon="search">검색 결과가 없어요.</Empty>;
  const hasRatings = results.ids.some(id => byId[id]?.rating != null);
  const hasHours = results.ids.some(id => byId[id]?.hours);
  const isFood = results.cat === 'food';

  return (
    <div>
      <PanelHead title={results.title} onBack={() => { clearSearch(); ui().pop(); }}>
        {results.ids.length > 0 && <span className="pill num">{list.length}곳</span>}
      </PanelHead>
      {(hasHours || hasRatings || isFood) && !results.loading && (
        <div className="filters" data-nodrag>
          {hasHours && <button className="chip flat" aria-pressed={openNow} onClick={() => setOpenNow(!openNow)} style={{ ['--c' as string]: 'var(--ok)' }}><I name="clock" />영업 중</button>}
          {hasRatings && <button className="chip flat" aria-pressed={minRating} onClick={() => setMinRating(!minRating)} style={{ ['--c' as string]: '#C98A00' }}><I name="star" />4.0 이상</button>}
          {hasRatings && <button className="chip flat" onClick={() => setSort(sort === 'distance' ? 'rating' : 'distance')}>{sort === 'distance' ? '가까운 순' : '평점 순'}<I name="down" /></button>}
          {isFood && FOOD_KINDS.map(k => (
            <button key={k.key} className="chip flat" aria-pressed={results.kind === k.gType} style={{ ['--c' as string]: '#E0531B' }}
              onClick={() => results.kind === k.gType ? runCategory('food') : runCategory('food', engine === 'google' ? { gType: k.gType, label: `식당 · ${k.label}` } : { keyword: k.osmCuisine, label: `식당 · ${k.label}` })}>
              {k.label}
            </button>
          ))}
        </div>
      )}
      {results.meta && <p className="small muted" style={{ margin: '0 0 4px' }}>{results.meta}</p>}
      {results.loading ? (
        <div style={{ padding: '18px 0' }}><Dots /></div>
      ) : results.error ? (
        <Empty icon="alert">{results.error}</Empty>
      ) : list.length ? (
        <ul className="results">
          {list.map(p => <ResultRow key={p.id} p={p} onOpen={() => openPlace(p.id)} showThumb={engine === 'google' && !dataSaver} />)}
        </ul>
      ) : (
        <Empty icon="search">조건에 맞는 곳이 없어요. 필터를 풀거나 지도를 옮긴 뒤 다시 찾아보세요.</Empty>
      )}
      <div className="stack" style={{ marginTop: 12 }}>
        {results.query && <button className="btn ghost block" onClick={() => ui().ask(`${results.query} 찾아줘. 위치랑 특징 비교해서 추천해줘`)}><I name="ai" />AI에게 “{results.query}” 물어보기</button>}
        {results.cat && !results.query && <button className="btn ghost block" onClick={() => ui().ask(`근처 ${results.title} 중에 어디가 좋을지 추천해줘`)}><I name="ai" />AI에게 추천받기</button>}
        {results.gLink && <ExtLink href={results.gLink} className="more-link"><I name="ext" />구글지도 앱에서 이 주변 더 보기</ExtLink>}
      </div>
      <div className="attrib">{attribution(list.map(p => p.source), engine)}</div>
    </div>
  );
}
