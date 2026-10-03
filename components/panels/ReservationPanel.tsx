'use client';

import { useEffect, useState } from 'react';
import { openPlace, startDirections } from '@/lib/actions';
import { parseJst } from '@/lib/format';
import { buildIcs, downloadText } from '@/lib/ics';
import { localName } from '@/lib/places';
import { getBlob } from '@/lib/store/idb';
import { places } from '@/lib/store/places';
import { useTrip, tripStore } from '@/lib/store/trip';
import { toast, ui } from '@/lib/store/ui';
import { I } from '../Icons';
import { useNow, useObjectUrl } from '../hooks';
import { Empty, PanelHead } from '../ui';
import { KIND_META, ddayText, whenText } from './ReservationsPanel';
import { savedToSummary } from './SavedPanel';

function Photo({ id }: { id: string }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => { void getBlob(id).then(b => setBlob(b || null)); }, [id]);
  const url = useObjectUrl(blob);
  if (!url) return <div className="ph" />;
  return <button className="ph" onClick={() => ui().open({ type: 'photo', src: url })}><img src={url} alt="예약 확인서" /></button>;
}

export default function ReservationPanel({ id }: { id: string }) {
  const r = useTrip(s => s.reservations.find(x => x.id === id));
  const now = useNow(60000);
  if (!r) return <div><PanelHead title="예약" /><Empty>예약을 찾을 수 없어요.</Empty></div>;
  const m = KIND_META[r.kind] || KIND_META.other;
  const dd = ddayText(r, now);

  const ics = () => {
    const start = parseJst(r.date, r.time || '09:00');
    if (!start) return;
    const end = r.kind === 'hotel' && r.endDate ? parseJst(r.endDate, r.endTime || '11:00') || undefined : new Date(start.getTime() + 90 * 60000);
    downloadText(`${r.title}.ics`, buildIcs([{ uid: r.id, start, end, title: `[예약] ${r.title}`, location: r.place?.nameLocal || r.place?.address || r.place?.name, description: [r.people ? `${r.people}명` : '', r.confirmation ? `예약번호 ${r.confirmation}` : '', r.platform || '', r.note || ''].filter(Boolean).join('\n'), alarmMin: r.kind === 'hotel' ? 180 : 60 }]));
  };
  const share = async () => {
    const text = `[예약] ${r.title}\n${whenText(r)}${r.people ? ` · ${r.people}명` : ''}${r.confirmation ? `\n예약번호: ${r.confirmation}` : ''}${r.place ? `\n${r.place.nameLocal || r.place.name}${r.place.address ? ` · ${r.place.address}` : ''}` : ''}`;
    try { if (navigator.share) { await navigator.share({ title: r.title, text }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(text); toast('복사했어요'); } catch { toast('공유하지 못했어요'); }
  };
  const showStaff = async () => {
    let name = r.place?.nameLocal || r.title;
    if (r.place?.placeId) { const ja = await localName(savedToSummary(r.place)).catch(() => null); if (ja?.name) name = ja.name; }
    const t = r.time ? `${Number(r.time.slice(0, 2))}時${r.time.slice(3) !== '00' ? `${Number(r.time.slice(3))}分` : ''}` : '';
    ui().open({ type: 'bigtext', lead: '予約しています', ja: `${t}に${r.people ? `${r.people}名で` : ''}予約しています`, ko: `${r.title}${r.time ? ` · ${r.time}` : ''}${r.people ? ` · ${r.people}명` : ''}`, addr: `${name}${r.confirmation ? `\n予約番号: ${r.confirmation}` : ''}` });
  };

  return (
    <div>
      <PanelHead title={<span className="p-kind" style={{ ['--c' as string]: m.color }}><I name={m.icon} />{m.label} 예약</span>}>
        <button className="icon-btn" onClick={() => ui().open({ type: 'resForm', id: r.id })} aria-label="수정"><I name="edit" /></button>
      </PanelHead>
      <h1 className="p-name">{r.title}</h1>
      <div className="p-line">
        <span className="num" style={{ fontWeight: 700, color: 'var(--ink)' }}>{whenText(r)}</span>
        {dd && <span className="pill sign">{dd}</span>}
        {r.status === 'pending' && <span className="pill warn">확정 대기</span>}
        {r.status === 'cancelled' && <span className="pill bad">취소됨</span>}
      </div>
      <div className="facts">
        {r.people != null && <div className="fact"><I name="people" /><span className="v">{r.people}명</span><span /></div>}
        {r.confirmation && (
          <button className="fact" onClick={async () => { try { await navigator.clipboard.writeText(r.confirmation!); toast('예약번호를 복사했어요'); } catch { /* ignore */ } }}>
            <I name="ticket" /><span className="v"><span className="small muted">예약번호</span><br /><b className="num" style={{ fontSize: 20, letterSpacing: '.04em' }}>{r.confirmation}</b></span><I name="copy" className="sm" />
          </button>
        )}
        {r.kind === 'hotel' && r.endDate && <div className="fact"><I name="calendar" /><span className="v">체크아웃 {r.endDate.slice(5).replace('-', '/')}{r.endTime ? ` ${r.endTime}` : ''}</span><span /></div>}
        {r.platform && <div className="fact"><I name="globe" /><span className="v">{r.platform}</span><span /></div>}
        {r.price && <div className="fact"><I name="yen" /><span className="v">{r.price}</span><span /></div>}
        {r.note && <div className="fact"><I name="info" /><span className="v" style={{ whiteSpace: 'pre-wrap' }}>{r.note}</span><span /></div>}
        {r.place && (
          <button className="fact" onClick={() => { places().register(savedToSummary(r.place!)); openPlace(r.place!.id); }}>
            <I name="pin" /><span className="v">{r.place.name}{r.place.address && <><br /><span className="small muted">{r.place.address}</span></>}</span><I name="chevron" className="sm" />
          </button>
        )}
      </div>
      {r.photoIds && r.photoIds.length > 0 && (
        <>
          <h3 className="sec">확인서</h3>
          <div className="photo-row">{r.photoIds.map(p => <Photo key={p} id={p} />)}</div>
        </>
      )}
      <div className="stack" style={{ marginTop: 14 }}>
        {r.place && <button className="btn primary lg block" onClick={() => startDirections(r.place!)}><I name="route" />길찾기</button>}
        <button className="btn sign block" onClick={showStaff}><I name="big" />직원에게 예약 보여주기</button>
        <div className="hstack">
          <button className="btn grow" onClick={ics}><I name="calendar" />캘린더에 추가</button>
          <button className="btn grow" onClick={share}><I name="share" />공유</button>
        </div>
        {r.status !== 'cancelled'
          ? <button className="btn danger block" onClick={() => { tripStore().upsertReservation({ ...r, status: 'cancelled' }); toast('취소로 표시했어요'); }}>취소됨으로 표시</button>
          : <button className="btn block" onClick={() => tripStore().upsertReservation({ ...r, status: 'booked' })}>다시 예약됨으로</button>}
        <button className="btn ghost danger block" onClick={() => { if (confirm('이 예약을 지울까요?')) { tripStore().deleteReservation(r.id); ui().pop(); } }}><I name="trash" />삭제</button>
      </div>
    </div>
  );
}
