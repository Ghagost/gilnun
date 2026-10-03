'use client';

import { useEffect, useState } from 'react';
import { category } from '@/lib/categories';
import { daysBetween, fmtDateKo, parseJst } from '@/lib/format';
import { decodeShare, parseSharedTrip, type SharedTrip } from '@/lib/share';
import { tripStore } from '@/lib/store/trip';
import { toast, ui } from '@/lib/store/ui';
import type { Trip } from '@/lib/types';
import { I } from '../Icons';
import { Dots } from '../ui';

export default function ImportTrip({ token }: { token: string }) {
  const [data, setData] = useState<SharedTrip | null | 'bad'>(null);
  useEffect(() => {
    let alive = true;
    void decodeShare(token).then(d => { if (alive) setData(parseSharedTrip(d) || 'bad'); });
    return () => { alive = false; };
  }, [token]);
  const close = () => ui().close('import');

  const doImport = () => {
    if (!data || data === 'bad') return;
    const trip: Trip = {
      id: '', title: data.title, city: data.city, start: data.start, end: data.end, createdAt: 0, updatedAt: 0,
      days: data.days.map(d => ({ date: d.date, stops: d.stops.map(s => ({ id: '', place: { ...s.place, category: category(s.place.category).key }, time: s.time, note: s.note })) })),
    };
    const id = tripStore().importTrip(trip);
    close();
    const u = ui();
    if (u.tab !== 'trip') u.setTab('trip', 'half');
    ui().push({ type: 'trip', id });
    toast('일정을 가져왔어요');
  };

  const stops = data && data !== 'bad' ? data.days.reduce((n, d) => n + d.stops.length, 0) : 0;
  return (
    <div className="overlay" onClick={close}>
      <div className="modal" role="dialog" aria-label="공유받은 일정" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>공유받은 일정</h2>
          <button className="icon-btn" onClick={close} aria-label="닫기"><I name="x" /></button>
        </div>
        {data === null ? <Dots /> : data === 'bad' ? (
          <div className="stack">
            <p className="small muted">링크가 잘렸거나 이 브라우저에서 열 수 없는 형식이에요. 링크 전체를 다시 복사해서 열어 주세요.</p>
            <button className="btn block" onClick={close}>닫기</button>
          </div>
        ) : (
          <div className="stack">
            <div className="card soft stack" style={{ gap: 4 }}>
              <b style={{ fontSize: 17 }}>{data.title}</b>
              <span className="small muted">{fmtDateKo(parseJst(data.start)!)} ~ {fmtDateKo(parseJst(data.end)!)} · {daysBetween(data.start, data.end) + 1}일{data.city ? ` · ${data.city}` : ''} · 장소 {stops}곳</span>
            </div>
            <div className="stack" style={{ gap: 6, maxHeight: '40dvh', overflowY: 'auto' }}>
              {data.days.filter(d => d.stops.length).map((d, i) => (
                <div key={d.date} className="small">
                  <b>{i + 1}일차 · {d.date.slice(5).replace('-', '/')}</b>
                  <div className="muted">{d.stops.map(s => `${s.time ? `${s.time} ` : ''}${s.place.name}`).join(' → ')}</div>
                </div>
              ))}
            </div>
            <button className="btn primary lg block" onClick={doImport}><I name="download" />내 일정으로 가져오기</button>
            <p className="hint">가져온 일정은 이 기기에만 저장돼요. 원래 일정과는 따로 움직여요.</p>
          </div>
        )}
      </div>
    </div>
  );
}
