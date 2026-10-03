'use client';

import { useMemo, useState } from 'react';
import { category } from '@/lib/categories';
import { openPlace } from '@/lib/actions';
import { distance, fmtDist } from '@/lib/geo';
import { mapApi } from '@/lib/map/instance';
import { useGeo } from '@/lib/store/geo';
import { places } from '@/lib/store/places';
import { useTrip, tripStore } from '@/lib/store/trip';
import type { PlaceSummary, SavedEntry } from '@/lib/types';
import { I } from '../Icons';
import { Empty, PanelHead } from '../ui';

export function savedToSummary(e: Pick<SavedEntry, 'id' | 'placeId' | 'name' | 'nameLocal' | 'lat' | 'lng' | 'category' | 'address'>): PlaceSummary {
  return { id: e.id, source: e.id.startsWith('g:') ? 'google' : 'custom', placeId: e.placeId, name: e.name, nameLocal: e.nameLocal, lat: e.lat, lng: e.lng, category: e.category, address: e.address };
}

export default function SavedPanel() {
  const saved = useTrip(s => s.saved);
  const lists = useTrip(s => s.lists);
  const me = useGeo(s => s.me);
  const [list, setList] = useState<string>('all');
  const entries = useMemo(() => Object.values(saved)
    .filter(e => list === 'all' || e.lists.includes(list))
    .sort((a, b) => (me ? distance(me, a) - distance(me, b) : b.savedAt - a.savedAt)), [saved, list, me]);

  const showAll = () => {
    const ids = entries.map(e => { places().register(savedToSummary(e)); return e.id; });
    places().setMarkers(ids);
    mapApi.fit(entries.map(e => ({ lat: e.lat, lng: e.lng })));
  };

  return (
    <div>
      <PanelHead title="저장한 곳">
        {entries.length > 0 && <button className="btn sm" onClick={showAll}><I name="map" />지도에 표시</button>}
      </PanelHead>
      <div className="filters" data-nodrag>
        <button className="chip flat" aria-pressed={list === 'all'} onClick={() => setList('all')}>전체 {Object.keys(saved).length}</button>
        {lists.map(l => <button key={l.id} className="chip flat" aria-pressed={list === l.id} onClick={() => setList(l.id)}>{l.emoji} {l.name}</button>)}
      </div>
      {entries.length === 0 ? (
        <Empty icon="bookmark">저장한 곳이 없어요. 장소 화면의 ‘저장’을 누르면 여기에 모여요.</Empty>
      ) : (
        <ul className="results">
          {entries.map(e => {
            const C = category(e.category);
            return (
              <li key={e.id}>
                <div className="result" style={{ alignItems: 'center' }}>
                  <button className="t" style={{ textAlign: 'left' }} onClick={() => { places().register(savedToSummary(e)); openPlace(e.id); }}>
                    <span className="name"><span className="badge" style={{ ['--c' as string]: C.color }}><I name={C.icon} className="sm" /></span><b>{e.name}</b></span>
                    <span className="sub">{[e.nameLocal, e.address].filter(Boolean).join(' · ')}</span>
                    <span className="meta">
                      {e.lists.map(id => lists.find(l => l.id === id)).filter(Boolean).map(l => <span key={l!.id} className="pill">{l!.emoji} {l!.name}</span>)}
                      {me && <span className="dist">{fmtDist(distance(me, e))}</span>}
                    </span>
                  </button>
                  <div className="hstack" style={{ gap: 2 }}>
                    <select className="select" style={{ minHeight: 34, width: 'auto', padding: '4px 6px', fontSize: 13 }} value={e.lists[0] || 'want'} onChange={ev => tripStore().setSavedLists(e.id, [ev.target.value])} aria-label="목록 바꾸기">
                      {lists.map(l => <option key={l.id} value={l.id}>{l.emoji} {l.name}</option>)}
                    </select>
                    <button className="icon-btn" onClick={() => tripStore().toggleSaved(e)} aria-label="저장 취소"><I name="trash" /></button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
