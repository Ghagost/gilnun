'use client';

import { useMemo, useState } from 'react';
import { daysBetween, fmtDateKo, isoDate, parseJst } from '@/lib/format';
import { useTrip } from '@/lib/store/trip';
import { ui } from '@/lib/store/ui';
import type { Reservation, ReservationKind } from '@/lib/types';
import { I } from '../Icons';
import { useNow } from '../hooks';
import { Dots, PanelHead } from '../ui';

export const KIND_META: Record<ReservationKind, { label: string; icon: string; color: string }> = {
  restaurant: { label: '식당', icon: 'food', color: '#E0531B' },
  hotel: { label: '숙소', icon: 'bed', color: '#6E46C6' },
  activity: { label: '입장권·투어', icon: 'torii', color: '#C63B2B' },
  transport: { label: '교통', icon: 'train', color: '#0B5FB0' },
  rental: { label: '렌터카', icon: 'car', color: '#3A4A55' },
  other: { label: '기타', icon: 'ticket', color: '#4A525B' },
};

export function whenText(r: Reservation): string {
  const d = parseJst(r.date);
  const base = d ? fmtDateKo(d) : r.date;
  if (r.kind === 'hotel' && r.endDate) {
    const n = daysBetween(r.date, r.endDate);
    return `${base} 체크인${r.time ? ` ${r.time}` : ''} · ${n}박`;
  }
  return `${base}${r.time ? ` ${r.time}` : ''}`;
}

export function ddayText(r: Reservation, now: number): string | null {
  const today = isoDate(new Date(now));
  const diff = daysBetween(today, r.date);
  if (diff < 0) return r.kind === 'hotel' && r.endDate && r.endDate >= today ? '숙박 중' : null;
  if (diff === 0) {
    if (!r.time) return '오늘';
    const at = parseJst(r.date, r.time);
    const mins = at ? Math.round((at.getTime() - now) / 60000) : null;
    if (mins == null) return '오늘';
    if (mins < -60) return '오늘 (지남)';
    if (mins < 0) return '지금';
    if (mins < 120) return `${mins}분 후`;
    return `오늘 ${r.time}`;
  }
  return `D-${diff}`;
}

export default function ReservationsPanel() {
  const reservations = useTrip(s => s.reservations);
  const hydrated = useTrip(s => s.hydrated);
  const now = useNow(60000);
  const [showPast, setShowPast] = useState(false);
  const today = isoDate(new Date(now));
  const { upcoming, past, cancelled } = useMemo(() => {
    const key = (r: Reservation) => r.date + (r.time || '99:99');
    const live = reservations.filter(r => r.status !== 'cancelled');
    return {
      upcoming: live.filter(r => r.date >= today || (r.endDate && r.endDate >= today)).sort((a, b) => key(a).localeCompare(key(b))),
      past: live.filter(r => r.date < today && !(r.endDate && r.endDate >= today)).sort((a, b) => key(b).localeCompare(key(a))),
      cancelled: reservations.filter(r => r.status === 'cancelled'),
    };
  }, [reservations, today]);

  const Card = ({ r, dim }: { r: Reservation; dim?: boolean }) => {
    const m = KIND_META[r.kind] || KIND_META.other;
    const dd = ddayText(r, now);
    return (
      <button className={`res-card${dim ? ' past' : ''}${r.status === 'cancelled' ? ' cancelled' : ''}`} onClick={() => ui().push({ type: 'reservation', id: r.id })}>
        <span className="k" style={{ ['--c' as string]: m.color }}><I name={m.icon} className="lg" /></span>
        <span style={{ minWidth: 0 }}>
          <b>{r.title}</b>
          <span className="when">{whenText(r)}{r.people ? ` · ${r.people}명` : ''}</span>
          {r.status === 'pending' && <span className="pill warn" style={{ marginTop: 4 }}>확정 대기</span>}
        </span>
        {dd && !dim && <span className="dday">{dd}</span>}
      </button>
    );
  };

  return (
    <div>
      <PanelHead title="예약" back={false}>
        <button className="btn sm primary" onClick={() => ui().open({ type: 'resForm' })}><I name="plus" />추가</button>
      </PanelHead>
      {!hydrated ? <Dots /> : reservations.length === 0 ? (
        <div className="stack" style={{ paddingTop: 6 }}>
          <div className="card soft stack" style={{ gap: 8 }}>
            <b style={{ fontSize: 17 }}>여기저기 흩어진 예약을 한 곳에</b>
            <span className="small muted">식당·숙소·입장권·렌터카 예약을 모아 시간순으로 보여주고, 시간이 다가오면 알려줘요. 예약 확인 화면을 캡처해서 넣으면 AI가 날짜·시간·예약번호를 자동으로 채워요.</span>
          </div>
          <button className="btn sign lg block" onClick={() => ui().open({ type: 'resForm', prefill: { scan: true } })}><I name="camera" />확인서 사진으로 추가</button>
          <button className="btn lg block" onClick={() => ui().open({ type: 'resForm' })}><I name="edit" />직접 입력</button>
          <p className="hint">예약하기: 장소 화면의 노란 ‘예약’ 버튼에서 구글지도·타베로그·Booking.com 등으로 바로 이동할 수 있어요.</p>
        </div>
      ) : (
        <>
          {upcoming.length ? upcoming.map(r => <Card key={r.id} r={r} />) : <p className="small muted">다가오는 예약이 없어요.</p>}
          <div className="hstack" style={{ marginTop: 6 }}>
            <button className="btn sm ghost" onClick={() => ui().open({ type: 'resForm', prefill: { scan: true } })}><I name="camera" />확인서 사진으로 추가</button>
          </div>
          {(past.length > 0 || cancelled.length > 0) && (
            <>
              <button className="sec" style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => setShowPast(!showPast)}>지난 예약·취소 {past.length + cancelled.length}<I name={showPast ? 'up' : 'down'} className="sm" /></button>
              {showPast && [...past, ...cancelled].map(r => <Card key={r.id} r={r} dim />)}
            </>
          )}
        </>
      )}
    </div>
  );
}
