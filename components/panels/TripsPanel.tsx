'use client';

import { daysBetween, isoDate } from '@/lib/format';
import { useTrip } from '@/lib/store/trip';
import { ui } from '@/lib/store/ui';
import { I } from '../Icons';
import { Dots, PanelHead } from '../ui';

export default function TripsPanel() {
  const trips = useTrip(s => s.trips);
  const hydrated = useTrip(s => s.hydrated);
  const activeTripId = useTrip(s => s.activeTripId);
  const today = isoDate(new Date());
  const sorted = [...trips].sort((a, b) => {
    const ra = a.end < today ? 2 : a.start <= today ? 0 : 1;
    const rb = b.end < today ? 2 : b.start <= today ? 0 : 1;
    return ra - rb || a.start.localeCompare(b.start);
  });
  return (
    <div>
      <PanelHead title="여행 일정" back={false}>
        <button className="btn sm primary" onClick={() => ui().open({ type: 'tripForm' })}><I name="plus" />새 일정</button>
      </PanelHead>
      {!hydrated ? <Dots /> : trips.length === 0 ? (
        <div className="stack" style={{ paddingTop: 8 }}>
          <div className="card soft stack" style={{ gap: 8 }}>
            <b style={{ fontSize: 17 }}>날짜별 여행 일정을 지도와 함께</b>
            <span className="small muted">장소를 날짜에 넣으면 지도에 순서대로 표시되고, 동선 정리·이동 시간·예약 시간까지 한눈에 보여요. 같이 가는 사람에게 링크로 공유할 수 있어요.</span>
          </div>
          <button className="btn primary lg block" onClick={() => ui().open({ type: 'tripForm' })}><I name="plus" />새 일정 만들기</button>
          <button className="btn sign lg block" onClick={() => ui().ask('여행 일정을 짜줘. 도시, 날짜, 좋아하는 것을 물어보고 앱의 일정에 넣어줘.', { send: false })}><I name="ai" />AI로 일정 짜기</button>
        </div>
      ) : (
        <div className="stack">
          {sorted.map(t => {
            const n = daysBetween(t.start, t.end) + 1;
            const stops = t.days.reduce((a, d) => a + d.stops.length, 0);
            const live = t.start <= today && t.end >= today;
            const past = t.end < today;
            return (
              <button key={t.id} className="trip-card" style={past ? { opacity: 0.6 } : undefined} onClick={() => { useTrip.getState().setActiveTrip(t.id); ui().push({ type: 'trip', id: t.id }); }}>
                <div className="hstack">
                  <b className="grow ellipsis">{t.title}</b>
                  {live && <span className="pill sign">여행 중</span>}
                  {t.id === activeTripId && !live && <span className="pill">현재 일정</span>}
                </div>
                <span className="when">{t.start.replace(/-/g, '.')} – {t.end.slice(5).replace('-', '.')} · {n - 1}박 {n}일{t.city ? ` · ${t.city}` : ''}</span>
                <span className="small muted">장소 {stops}곳</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
