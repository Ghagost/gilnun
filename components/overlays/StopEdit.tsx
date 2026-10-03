'use client';

import { useState } from 'react';
import { openPlace, startDirections } from '@/lib/actions';
import { fmtDateKo, parseJst } from '@/lib/format';
import { places } from '@/lib/store/places';
import { tripStore, useTrip } from '@/lib/store/trip';
import { toast, ui } from '@/lib/store/ui';
import { I } from '../Icons';
import { savedToSummary } from '../panels/SavedPanel';
import { Empty } from '../ui';

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

export default function StopEdit({ tripId, date, stopId }: { tripId: string; date: string; stopId: string }) {
  const trip = useTrip(s => s.trips.find(t => t.id === tripId));
  const stop = trip?.days.find(d => d.date === date)?.stops.find(s => s.id === stopId);
  const [time, setTime] = useState(stop?.time || '');
  const [dur, setDur] = useState(stop?.durationMin ? String(stop.durationMin) : '');
  const [note, setNote] = useState(stop?.note || '');
  const [day, setDay] = useState(date);
  const [done, setDone] = useState(!!stop?.done);
  const close = () => ui().close('stopEdit');

  if (!trip || !stop) {
    return <div className="overlay" onClick={close}><div className="modal" onClick={e => e.stopPropagation()}><Empty>이 장소를 찾을 수 없어요.</Empty></div></div>;
  }

  const save = () => {
    const ts = tripStore();
    ts.updateStop(tripId, date, stopId, { time: /^\d{2}:\d{2}$/.test(time) ? time : undefined, durationMin: Number(dur) || undefined, note: note.trim() || undefined, done });
    if (day !== date) ts.moveStopToDay(tripId, date, stopId, day);
    toast('저장했어요');
    close();
  };
  const remove = () => {
    tripStore().removeStop(tripId, date, stopId);
    toast(`${stop.place.name}을(를) 일정에서 뺐어요`);
    close();
  };
  const show = () => {
    places().register(savedToSummary(stop.place));
    close();
    openPlace(stop.place.id);
  };

  return (
    <div className="overlay" onClick={close}>
      <form className="modal" role="dialog" aria-label="일정 장소 편집" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); save(); }}>
        <div className="modal-head">
          <h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stop.place.name}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="닫기"><I name="x" /></button>
        </div>
        <div className="stack">
          <div className="hstack wrap" style={{ gap: 6 }}>
            <button type="button" className="btn sm" onClick={show}><I name="map" />지도에서 보기</button>
            <button type="button" className="btn sm" onClick={() => { close(); startDirections(stop.place); }}><I name="route" />길찾기</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div className="field"><label htmlFor="se-time">시간</label><input id="se-time" className="input" type="time" value={time} onChange={e => setTime(e.target.value)} /></div>
            <div className="field">
              <label htmlFor="se-dur">머무는 시간</label>
              <select id="se-dur" className="select" value={dur} onChange={e => setDur(e.target.value)}>
                <option value="">정하지 않음</option>
                {DURATIONS.map(m => <option key={m} value={m}>{m < 60 ? `${m}분` : `${m / 60}시간${m % 60 ? ` ${m % 60}분` : ''}`}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="se-day">날짜</label>
            <select id="se-day" className="select" value={day} onChange={e => setDay(e.target.value)}>
              {trip.days.map((d, i) => <option key={d.date} value={d.date}>{i + 1}일차 · {fmtDateKo(parseJst(d.date)!)}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="se-note">메모</label><textarea id="se-note" className="textarea" value={note} onChange={e => setNote(e.target.value.slice(0, 300))} placeholder="예: 오픈런, 2층 창가 자리, 현금만" /></div>
          <label className="check"><input type="checkbox" checked={done} onChange={e => setDone(e.target.checked)} />다녀왔어요</label>
          <button type="submit" className="btn primary lg block">저장</button>
          <button type="button" className="btn ghost danger block" onClick={remove}><I name="trash" />일정에서 빼기</button>
        </div>
      </form>
    </div>
  );
}
