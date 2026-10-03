'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { category } from '@/lib/categories';
import { openPlace, startDirections } from '@/lib/actions';
import { distance, fmtDist, walkMinutes } from '@/lib/geo';
import { fmtDateKo, isoDate, parseJst } from '@/lib/format';
import { buildIcs, downloadText } from '@/lib/ics';
import { mapApi } from '@/lib/map/instance';
import { encodeShare } from '@/lib/share';
import { places } from '@/lib/store/places';
import { useTrip, tripStore, optimizeStops } from '@/lib/store/trip';
import { toast, ui, useUi } from '@/lib/store/ui';
import type { Reservation, Trip, TripStop } from '@/lib/types';
import { I } from '../Icons';
import { Empty, PanelHead } from '../ui';
import { savedToSummary } from './SavedPanel';

/** Which trip day the map shows while the trip tab is open. */
export const useTripView = create<{ tripId: string | null; date: string | null; set: (tripId: string | null, date: string | null) => void }>(set => ({
  tripId: null, date: null, set: (tripId, date) => set({ tripId, date }),
}));

const RES_ICON: Record<string, string> = { restaurant: 'food', hotel: 'bed', activity: 'torii', transport: 'train', rental: 'car', other: 'ticket' };

/** Draws numbered pins and a dashed path for the selected trip day. */
export function useTripPins() {
  const tab = useUi(s => s.tab);
  const view = useTripView();
  const trips = useTrip(s => s.trips);
  const reservations = useTrip(s => s.reservations);
  const fitted = useRef('');
  useEffect(() => {
    const trip = trips.find(t => t.id === view.tripId);
    const day = trip?.days.find(d => d.date === view.date);
    if (tab !== 'trip' || !trip || !day) {
      if (places().extraPins.length) places().setExtraPins([]);
      if (places().routes.some(r => r.id === 'trip')) places().setRoutes(places().routes.filter(r => r.id !== 'trip'));
      fitted.current = '';
      return;
    }
    const pins = day.stops.map((s, i) => ({ id: s.id, lat: s.place.lat, lng: s.place.lng, label: String(i + 1), color: category(s.place.category).color, kind: 'stop' as const }));
    const res = reservations.filter(r => r.date === day.date && r.place && r.status !== 'cancelled').map(r => ({ id: r.id, lat: r.place!.lat, lng: r.place!.lng, label: '', icon: RES_ICON[r.kind] || 'ticket', color: '#FFD21F', kind: 'res' as const }));
    places().setExtraPins([...pins, ...res]);
    const pts = day.stops.map(s => ({ lat: s.place.lat, lng: s.place.lng }));
    places().setRoutes([...places().routes.filter(r => r.id !== 'trip'), ...(pts.length > 1 ? [{ id: 'trip', points: pts, color: '#111214', width: 3, dashed: true }] : [])]);
    const key = `${trip.id}|${day.date}|${pts.length}`;
    if (pts.length + res.length && fitted.current !== key) { fitted.current = key; mapApi.fit([...pts, ...res.map(r => ({ lat: r.lat, lng: r.lng }))]); }
  }, [tab, view.tripId, view.date, trips, reservations]);
}

export function tripSummaryText(t: Trip, reservations: Reservation[] = []): string {
  const lines = [`여행: ${t.title}${t.city ? ` (${t.city})` : ''}, ${t.start} ~ ${t.end}`];
  for (const d of t.days) {
    const rs = reservations.filter(r => r.date === d.date && r.status !== 'cancelled');
    const items = [...d.stops.map(s => `${s.time ? s.time + ' ' : ''}${s.place.name}${s.place.nameLocal ? `(${s.place.nameLocal})` : ''}${s.note ? ` [${s.note}]` : ''}`), ...rs.map(r => `[예약] ${r.time || ''} ${r.title}`)];
    lines.push(`- ${d.date}: ${items.length ? items.join(' → ') : '(비어 있음)'}`);
  }
  return lines.join('\n');
}

function Hop({ a, b }: { a: TripStop; b: TripStop }) {
  const d = distance(a.place, b.place);
  return (
    <div className="hop">
      <span />
      <span className="line" />
      <span className="num">{d < 1800 ? `도보 ${walkMinutes(d)}분 · ${fmtDist(d)}` : `${fmtDist(d)} · 전철·택시 권장`}</span>
    </div>
  );
}

export default function TripPanel({ id, initialDay }: { id: string; initialDay?: string }) {
  const trip = useTrip(s => s.trips.find(t => t.id === id));
  const reservations = useTrip(s => s.reservations);
  const today = isoDate(new Date());
  const [date, setDate] = useState<string>(() => {
    if (initialDay) return initialDay;
    const t = useTrip.getState().trips.find(x => x.id === id);
    return t?.days.find(d => d.date === today)?.date || t?.days[0]?.date || today;
  });
  const [menu, setMenu] = useState(false);

  useEffect(() => { useTripView.getState().set(id, date); return () => useTripView.getState().set(null, null); }, [id, date]);
  useEffect(() => { if (trip && !trip.days.some(d => d.date === date) && trip.days[0]) setDate(trip.days[0].date); }, [trip, date]);

  const day = trip?.days.find(d => d.date === date);
  const dayRes = useMemo(() => reservations.filter(r => r.date === date && r.status !== 'cancelled').sort((a, b) => (a.time || '').localeCompare(b.time || '')), [reservations, date]);

  if (!trip) return <div><PanelHead title="일정" /><Empty>일정을 찾을 수 없어요.</Empty></div>;

  const share = async () => {
    const token = await encodeShare({ title: trip.title, city: trip.city, start: trip.start, end: trip.end, days: trip.days.map(d => ({ date: d.date, stops: d.stops.map(s => ({ place: s.place, time: s.time, note: s.note })) })) });
    const url = `${location.origin}/#trip=${token}`;
    try { if (navigator.share) { await navigator.share({ title: trip.title, text: `${trip.title} 여행 일정`, url }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(url); toast('공유 링크를 복사했어요'); } catch { toast('공유하지 못했어요'); }
  };
  const exportIcs = () => {
    const events = trip.days.flatMap(d => d.stops.filter(s => s.time).map(s => ({
      uid: s.id, start: parseJst(d.date, s.time!)!, end: new Date(parseJst(d.date, s.time!)!.getTime() + (s.durationMin || 60) * 60000),
      title: s.place.name, location: s.place.nameLocal || s.place.address || s.place.name, description: s.note || '', alarmMin: 30,
    })));
    if (!events.length) { toast('시간을 정한 장소가 없어요. 장소의 시간을 먼저 넣어 주세요.'); return; }
    downloadText(`${trip.title}.ics`, buildIcs(events, trip.title));
  };
  const optimize = () => {
    if (!day || day.stops.length < 3) { toast('장소가 3곳 이상일 때 동선을 정리할 수 있어요'); return; }
    tripStore().setDayStops(trip.id, day.date, optimizeStops(day.stops));
    toast('가까운 순서로 동선을 정리했어요 (시간 정한 곳은 그대로)');
  };
  const addPlace = () => ui().open({ type: 'search', pick: { kind: 'trip', tripId: trip.id, date } });

  return (
    <div>
      <PanelHead title={trip.title}>
        <button className="icon-btn" onClick={share} aria-label="일정 공유"><I name="share" /></button>
        <button className="icon-btn" onClick={() => setMenu(!menu)} aria-label="더 보기" aria-expanded={menu}><I name="more" /></button>
      </PanelHead>
      {menu && (
        <div className="card" style={{ display: 'grid', gap: 4, marginBottom: 10 }}>
          <button className="btn ghost block" onClick={() => { setMenu(false); ui().open({ type: 'tripForm', id: trip.id }); }}><I name="edit" />이름·날짜 바꾸기</button>
          <button className="btn ghost block" onClick={() => { setMenu(false); exportIcs(); }}><I name="download" />캘린더로 내보내기 (.ics)</button>
          <button className="btn ghost block" onClick={() => { setMenu(false); ui().ask(`이 여행 일정을 검토해서 동선, 빠진 명소, 예약이 필요한 곳을 알려줘.\n\n${tripSummaryText(trip, reservations)}`); }}><I name="ai" />AI에게 일정 검토받기</button>
          <button className="btn ghost danger block" onClick={() => { if (confirm(`“${trip.title}” 일정을 지울까요?`)) { tripStore().deleteTrip(trip.id); ui().pop(); } }}><I name="trash" />일정 삭제</button>
        </div>
      )}
      <p className="small muted" style={{ margin: '-4px 0 10px' }}>{trip.start.replace(/-/g, '.')} – {trip.end.slice(5).replace('-', '.')}{trip.city ? ` · ${trip.city}` : ''}</p>
      <div className="days" data-nodrag>
        {trip.days.map((d, i) => {
          const dt = parseJst(d.date)!;
          return (
            <button key={d.date} className="day-tab" aria-pressed={d.date === date} onClick={() => setDate(d.date)}>
              <span>{i + 1}일차{d.date === today ? ' · 오늘' : ''}</span>
              <b>{fmtDateKo(dt).replace(/^\d+월 /, '')}</b>
            </button>
          );
        })}
      </div>
      {day && (
        <>
          <div className="timeline">
            {day.stops.length === 0 && dayRes.length === 0 && <Empty icon="calendar">이 날은 비어 있어요. 장소를 추가하거나 AI에게 채워 달라고 해 보세요.</Empty>}
            {day.stops.map((s, i) => (
              <div key={s.id}>
                {i > 0 && <Hop a={day.stops[i - 1]} b={s} />}
                <div className={`tstop${s.done ? ' done' : ''}`}>
                  <span className={`tm${s.time ? '' : ' none'}`}>{s.time || '시간'}</span>
                  <span className="no" style={{ ['--c' as string]: category(s.place.category).color }}>{i + 1}</span>
                  <button className="body" onClick={() => { places().register(savedToSummary(s.place)); openPlace(s.place.id); }}>
                    <b>{s.place.name}</b>
                    <span>{[s.place.nameLocal, s.note].filter(Boolean).join(' · ') || category(s.place.category).label}</span>
                  </button>
                  <span className="ops">
                    <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => startDirections(s.place)} aria-label="길찾기"><I name="route" className="sm" /></button>
                    <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => ui().open({ type: 'stopEdit', tripId: trip.id, date: day.date, stopId: s.id })} aria-label="편집"><I name="edit" className="sm" /></button>
                  </span>
                </div>
              </div>
            ))}
            {dayRes.map(r => (
              <div key={r.id} className="tstop res">
                <span className="tm">{r.time || ''}</span>
                <span className="no"><I name={RES_ICON[r.kind] || 'ticket'} className="sm" /></span>
                <button className="body" onClick={() => { ui().setTab('booking', 'half'); ui().push({ type: 'reservation', id: r.id }); }}>
                  <b>{r.title}</b><span>예약{r.people ? ` · ${r.people}명` : ''}{r.confirmation ? ` · #${r.confirmation}` : ''}</span>
                </button>
                <span />
              </div>
            ))}
          </div>
          <div className="hstack wrap" style={{ gap: 6, marginTop: 12 }}>
            <button className="btn primary" onClick={addPlace}><I name="plus" />장소 추가</button>
            <button className="btn" onClick={optimize}><I name="route" />동선 정리</button>
            <button className="btn sign" onClick={() => ui().ask(`${fmtDateKo(parseJst(day.date)!)} 일정을 채워줘. ${trip.city ? `도시: ${trip.city}. ` : ''}지금 일정과 예약 시간을 고려해서 동선이 좋은 순서로 3~5곳 추천하고 add_to_trip으로 ${day.date}에 넣어줘.\n\n${tripSummaryText(trip, reservations)}`)}><I name="ai" />AI로 채우기</button>
          </div>
        </>
      )}
    </div>
  );
}
