'use client';

import { useEffect, useRef, useState } from 'react';
import { CATEGORIES, category } from '@/lib/categories';
import { openPlace, runCategory, runTextSearch } from '@/lib/actions';
import { distance, fmtDist } from '@/lib/geo';
import { mapApi } from '@/lib/map/instance';
import { autocomplete, pickSuggestion, searchText, type Suggestion } from '@/lib/places';
import { listen, speechSupported } from '@/lib/speech';
import { useGeo, geo } from '@/lib/store/geo';
import { places, toSaved } from '@/lib/store/places';
import { useTrip, tripStore } from '@/lib/store/trip';
import { toast, ui, type PickTarget } from '@/lib/store/ui';
import type { PlaceSummary } from '@/lib/types';
import { I } from '../Icons';
import { useDebounced } from '../hooks';
import { Dots } from '../ui';

const RECENT_KEY = 'gilnun.recent';
function recent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 10); } catch { return []; }
}
function pushRecent(q: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...recent().filter(x => x !== q)].slice(0, 10))); } catch { /* ignore */ }
}

function Highlight({ text, ranges }: { text: string; ranges?: { start: number; end: number }[] }) {
  if (!ranges?.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let i = 0;
  ranges.forEach((r, k) => {
    if (r.start > i) out.push(text.slice(i, r.start));
    out.push(<mark key={k}>{text.slice(r.start, r.end)}</mark>);
    i = r.end;
  });
  out.push(text.slice(i));
  return <>{out}</>;
}

export default function SearchOverlay({ pick, initial, voice }: { pick?: PickTarget; initial?: string; voice?: boolean }) {
  const [q, setQ] = useState(initial || '');
  const [sugg, setSugg] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [pickResults, setPickResults] = useState<PlaceSummary[] | null>(null);
  const me = useGeo(s => s.me);
  const saved = useTrip(s => s.saved);
  const input = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q, 220);
  const seq = useRef(0);
  /** Query whose full results are on screen (a late autocomplete for the same text must not wipe them). */
  const submitted = useRef('');

  useEffect(() => { setTimeout(() => input.current?.focus(), 60); }, []);
  useEffect(() => { if (voice) void startVoice(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const term = dq.trim();
    if (term && term === submitted.current) return;
    submitted.current = '';
    setPickResults(null);
    if (term.length < 1) { setSugg([]); return; }
    const my = ++seq.current;
    setLoading(true);
    autocomplete(term, geo().me || mapApi.center()).then(r => { if (my === seq.current) setSugg(r); }).catch(() => { if (my === seq.current) setSugg([]); }).finally(() => { if (my === seq.current) setLoading(false); });
  }, [dq]);

  const close = () => ui().close('search');

  const choose = async (p: PlaceSummary) => {
    if (pick?.kind === 'trip') {
      const id = tripStore().addStop(pick.tripId, pick.date, toSaved(p));
      toast(id ? `${p.name}을(를) 일정에 추가했어요` : '일정에 추가하지 못했어요');
      close();
      return;
    }
    places().register(p);
    close();
    openPlace(p.id);
  };

  const onSuggestion = async (s: Suggestion) => {
    if (s.kind === 'query') { void submit(s.main); return; }
    pushRecent(s.main);
    setLoading(true);
    try {
      const p = await pickSuggestion(s);
      if (!p) { toast('장소를 불러오지 못했어요'); return; }
      await choose({ ...p, distance: me ? Math.round(distance(me, p)) : p.distance });
    } catch { toast('장소를 불러오지 못했어요'); } finally { setLoading(false); }
  };

  const submit = async (term = q) => {
    const t = term.trim();
    if (!t) return;
    pushRecent(t);
    if (pick) {
      submitted.current = t;
      const my = ++seq.current;
      setLoading(true);
      try {
        const r = await searchText(t, geo().me || mapApi.center(), { limit: 10 });
        if (my === seq.current) setPickResults(r.places);
      } catch { toast('검색하지 못했어요'); } finally { if (my === seq.current) setLoading(false); }
      return;
    }
    close();
    void runTextSearch(t);
  };

  async function startVoice() {
    if (!speechSupported()) { toast('이 브라우저는 음성 검색을 지원하지 않아요'); return; }
    setListening(true);
    try {
      const t = await listen('ko-KR', setQ).promise;
      if (t) { setQ(t); void submit(t); }
    } catch (e) { toast((e as Error).message === 'not-allowed' ? '마이크 권한을 허용해 주세요' : '음성을 알아듣지 못했어요'); } finally { setListening(false); }
  }

  const rec = recent();
  const savedList = Object.values(saved).slice(0, 6);
  const pickTrip = pick?.kind === 'trip' ? useTrip.getState().trips.find(t => t.id === pick.tripId) : null;

  return (
    <div className="fullscreen" role="dialog" aria-label="장소 검색">
      <div className="fs-head">
        <button className="back" onClick={close} aria-label="닫기"><I name="back" /></button>
        <form className="search-input" onSubmit={e => { e.preventDefault(); void submit(); }}>
          <I name="search" />
          <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder={listening ? '듣고 있어요…' : pick ? '추가할 장소 검색' : '역, 맛집, 주소, 호텔 이름…'} enterKeyHint="search" aria-label="검색어" autoComplete="off" />
          {q && <button type="button" className="icon-btn" onClick={() => { setQ(''); input.current?.focus(); }} aria-label="지우기"><I name="x" /></button>}
          <button type="button" className={`icon-btn${listening ? ' listening' : ''}`} onClick={startVoice} aria-label="음성 검색"><I name="mic" /></button>
        </form>
      </div>
      <div className="fs-body">
        {pickTrip && <div className="pill sign" style={{ margin: '4px 0 10px' }}>“{pickTrip.title}” {pick?.kind === 'trip' ? pick.date.slice(5).replace('-', '/') : ''}에 추가할 장소</div>}
        {loading && <div style={{ padding: '6px 0' }}><Dots /></div>}
        {pickResults ? (
          pickResults.length ? pickResults.map(p => {
            const C = category(p.category);
            return (
              <button key={p.id} className="sugg" onClick={() => void choose(p)}>
                <span className="ico" style={{ color: C.color }}><I name={C.icon} /></span>
                <span style={{ minWidth: 0 }}><b>{p.name}</b><span>{p.address || p.info || C.label}</span></span>
                <span className="d">{me ? fmtDist(distance(me, p)) : ''}</span>
              </button>
            );
          }) : <p className="small muted">검색 결과가 없어요.</p>
        ) : q.trim() ? (
          <>
            {sugg.map(s => {
              const C = category(s.category);
              return (
                <button key={s.id} className="sugg" onClick={() => void onSuggestion(s)}>
                  <span className="ico" style={{ color: s.kind === 'query' ? undefined : C.color }}><I name={s.kind === 'query' ? 'search' : C.icon} /></span>
                  <span style={{ minWidth: 0 }}><b><Highlight text={s.main} ranges={s.matches} /></b>{s.secondary && <span>{s.secondary}</span>}</span>
                  <span className="d">{s.distance != null ? fmtDist(s.distance) : ''}</span>
                </button>
              );
            })}
            <button className="sugg" onClick={() => void submit()}>
              <span className="ico"><I name="search" /></span>
              <span><b>“{q.trim()}” 검색</b><span>{pick ? '결과에서 고르기' : '지도에 모두 표시'}</span></span>
              <span />
            </button>
            {!pick && <button className="sugg" onClick={() => { close(); ui().ask(q.trim()); }}>
              <span className="ico" style={{ color: 'var(--ink)' }}><I name="ai" /></span>
              <span><b>AI에게 “{q.trim()}” 묻기</b><span>추천·비교·가는 법까지</span></span>
              <span />
            </button>}
          </>
        ) : (
          <>
            {!pick && (
              <div className="quick-cats" style={{ marginTop: 6 }}>
                {CATEGORIES.slice(0, 8).map(c => (
                  <button key={c.key} onClick={() => { close(); void runCategory(c.key); }}><I name={c.icon} style={{ ['--c' as string]: c.color }} />{c.label}</button>
                ))}
              </div>
            )}
            {rec.length > 0 && <h3 className="sec">최근 검색</h3>}
            {rec.map(r => (
              <button key={r} className="sugg" onClick={() => { setQ(r); void submit(r); }}>
                <span className="ico"><I name="clock" /></span><span><b>{r}</b></span><span />
              </button>
            ))}
            {savedList.length > 0 && <h3 className="sec">저장한 곳</h3>}
            {savedList.map(s => (
              <button key={s.id} className="sugg" onClick={() => void choose({ id: s.id, source: s.id.startsWith('g:') ? 'google' : 'custom', placeId: s.placeId, name: s.name, nameLocal: s.nameLocal, lat: s.lat, lng: s.lng, category: s.category, address: s.address })}>
                <span className="ico" style={{ color: category(s.category).color }}><I name="bookmark" /></span>
                <span style={{ minWidth: 0 }}><b>{s.name}</b><span>{s.address || category(s.category).label}</span></span>
                <span className="d">{me ? fmtDist(distance(me, s)) : ''}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
