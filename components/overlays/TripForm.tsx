'use client';

import { useState } from 'react';
import { effectiveProvider } from '@/lib/ai/run';
import { addDays, daysBetween, fmtDateKo, isoDate, parseJst } from '@/lib/format';
import { tripStore, useTrip } from '@/lib/store/trip';
import { toast, ui } from '@/lib/store/ui';
import { I } from '../Icons';

const CITIES = ['도쿄', '오사카', '교토', '후쿠오카', '삿포로', '나고야', '오키나와', '요코하마'];

export default function TripForm({ id }: { id?: string }) {
  const trip = useTrip(s => (id ? s.trips.find(t => t.id === id) : undefined));
  const today = isoDate(new Date());
  const [title, setTitle] = useState(trip?.title || '');
  const [city, setCity] = useState(trip?.city || '');
  const [start, setStart] = useState(trip?.start || today);
  const [end, setEnd] = useState(trip?.end || addDays(today, 3));
  const valid = !!parseJst(start) && !!parseJst(end) && end >= start;
  const nights = valid ? daysBetween(start, end) : 0;
  const outside = trip ? trip.days.filter(d => (d.date < start || d.date > end) && d.stops.length).reduce((n, d) => n + d.stops.length, 0) : 0;
  const close = () => ui().close('tripForm');

  const save = (withAi = false) => {
    if (!valid) { toast('날짜를 확인해 주세요'); return; }
    if (nights > 60) { toast('여행은 최대 61일까지 만들 수 있어요'); return; }
    const name = title.trim() || `${city.trim() || '일본'} 여행`;
    if (trip) {
      tripStore().updateTrip(trip.id, { title: name, city: city.trim() || undefined, start, end });
      toast(outside ? `수정했어요. 범위를 벗어난 장소 ${outside}곳은 마지막 날로 옮겼어요` : '수정했어요');
      close();
      return;
    }
    const tid = tripStore().createTrip({ title: name, city, start, end });
    close();
    const u = ui();
    if (u.tab !== 'trip') u.setTab('trip', 'half');
    ui().push({ type: 'trip', id: tid });
    if (withAi) {
      ui().ask(`방금 만든 "${name}" 일정(${start}~${end}${city.trim() ? `, ${city.trim()}` : ''})에 날짜별로 하루 4~5곳씩 동선이 좋게 장소를 add_to_trip으로 넣어줘. 첫날과 마지막 날은 이동을 생각해서 가볍게. 내 취향: `, { send: false });
    } else toast('일정을 만들었어요. 장소를 추가해 보세요');
  };

  const remove = () => {
    if (!trip || !confirm(`“${trip.title}” 일정을 지울까요? 되돌릴 수 없어요.`)) return;
    tripStore().deleteTrip(trip.id);
    close();
    ui().resetTab('trip');
    toast('일정을 지웠어요');
  };

  return (
    <div className="overlay" onClick={close}>
      <form className="modal" role="dialog" aria-label={trip ? '일정 수정' : '새 여행 일정'} onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); save(); }}>
        <div className="modal-head">
          <h2>{trip ? '일정 수정' : '새 여행 일정'}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="닫기"><I name="x" /></button>
        </div>
        <div className="stack">
          <div className="field">
            <span className="label">도시</span>
            <div className="hstack wrap" style={{ gap: 6 }}>
              {CITIES.map(c => <button type="button" key={c} className="chip flat" aria-pressed={city === c} onClick={() => setCity(city === c ? '' : c)}>{c}</button>)}
            </div>
            <input className="input" value={city} onChange={e => setCity(e.target.value.slice(0, 40))} placeholder="다른 도시 (예: 하코네)" aria-label="도시" />
          </div>
          <div className="field"><label htmlFor="tf-title">이름</label><input id="tf-title" className="input" value={title} onChange={e => setTitle(e.target.value.slice(0, 60))} placeholder={`${city || '일본'} 여행`} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div className="field"><label htmlFor="tf-start">가는 날</label><input id="tf-start" className="input" type="date" value={start} onChange={e => { const v = e.target.value; if (!v) return; setStart(v); if (end < v) setEnd(v); }} required /></div>
            <div className="field"><label htmlFor="tf-end">오는 날</label><input id="tf-end" className="input" type="date" value={end} min={start} onChange={e => e.target.value && setEnd(e.target.value)} required /></div>
          </div>
          <p className="hint">{valid ? `${fmtDateKo(parseJst(start)!)} ~ ${fmtDateKo(parseJst(end)!)} · ${nights}박 ${nights + 1}일` : '오는 날이 가는 날보다 빠를 수 없어요'}</p>
          {outside > 0 && <p className="hint" style={{ color: 'var(--warn)' }}>날짜 범위 밖에 있는 장소 {outside}곳은 마지막 날로 옮겨져요.</p>}
          <button type="submit" className="btn primary lg block" disabled={!valid}>{trip ? '저장' : '만들기'}</button>
          {!trip && effectiveProvider() && <button type="button" className="btn sign block" disabled={!valid} onClick={() => save(true)}><I name="ai" />만들고 AI에게 일정 채우기</button>}
          {trip && <button type="button" className="btn ghost danger block" onClick={remove}><I name="trash" />일정 지우기</button>}
        </div>
      </form>
    </div>
  );
}
