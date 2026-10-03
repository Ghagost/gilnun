'use client';

import { useLayoutEffect, useRef } from 'react';
import { CATEGORIES, type CategoryKey } from '@/lib/categories';
import { clearSearch, runCategory, startDirections } from '@/lib/actions';
import { distance, fmtDist, walkMinutes } from '@/lib/geo';
import { googleDirections } from '@/lib/links';
import { useGeo } from '@/lib/store/geo';
import { usePlaces, places } from '@/lib/store/places';
import { currentPanel, useUi, ui } from '@/lib/store/ui';
import { BrandMark, I } from './Icons';

export default function TopBar() {
  const ref = useRef<HTMLElement>(null);
  const dest = usePlaces(s => s.dest);
  const resultsCat = usePlaces(s => s.results?.cat);
  const resultsKind = usePlaces(s => s.results?.kind);
  const me = useGeo(s => s.me);
  const panel = useUi(s => currentPanel(s));
  const tab = useUi(s => s.tab);
  const sheet = useUi(s => s.sheet);
  const activeCat = tab === 'map' && panel.type === 'results' ? resultsCat : null;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--panel-top', `${Math.round(el.getBoundingClientRect().bottom + 8)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onChip = (k: CategoryKey) => {
    if (activeCat === k && !resultsKind) { clearSearch(); ui().resetTab('map'); ui().setSheet('peek'); return; }
    void runCategory(k);
  };

  const d = dest && me ? distance(me, dest) : null;
  const hidden = tab === 'map' && sheet === 'full' && typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <header ref={ref} className="topbar" style={hidden ? { visibility: 'hidden' } : undefined}>
      <div className="searchbar" role="search">
        <div className="brand" aria-hidden="true"><BrandMark /></div>
        <button className="placeholder" onClick={() => ui().open({ type: 'search' })} aria-label="장소 검색 열기">역·맛집·주소 검색 (한국어 OK)</button>
        <button className="icon-btn" onClick={() => ui().open({ type: 'search', voice: true })} aria-label="음성으로 검색"><I name="mic" /></button>
        <button className="icon-btn" onClick={() => { ui().setTab('tools'); ui().push({ type: 'settings' }); }} aria-label="설정"><I name="gear" /></button>
      </div>
      <nav className="chips" aria-label="주변 찾기" onWheel={e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY; }}>
        {CATEGORIES.filter(c => c.chip).map(c => (
          <button key={c.key} className="chip" style={{ ['--c' as string]: c.color }} aria-pressed={activeCat === c.key} onClick={() => onChip(c.key)}>
            <I name={c.icon} />{c.label}
          </button>
        ))}
      </nav>
      {dest && (
        <div className="route-pill">
          <button className="main" onClick={() => { const p = places().byId[dest.id]; if (p) { ui().setTab('map'); ui().push({ type: 'place', id: dest.id }); } else startDirections(dest); }}>
            <small>목적지</small>
            <b>{dest.name}</b>
            <span className="meta">{d != null ? `${fmtDist(d)} · 도보 ${walkMinutes(d)}분` : '내 위치 찾는 중'}</span>
          </button>
          <button className="act" onClick={() => startDirections(dest)} aria-label="길찾기"><I name="route" />경로</button>
          <a className="act" href={googleDirections({ ...dest, placeId: dest.placeId }, 'transit')} target="_blank" rel="noopener noreferrer" aria-label="구글지도 대중교통"><I name="train" /></a>
          <button className="act" onClick={() => ui().open({ type: 'camera' })} aria-label="카메라 길안내"><I name="camera" /></button>
          <button className="x" onClick={() => { places().setDest(null); places().setRoutes([]); }} aria-label="목적지 해제"><I name="x" /></button>
        </div>
      )}
    </header>
  );
}
