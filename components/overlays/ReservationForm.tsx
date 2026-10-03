'use client';

import { useEffect, useRef, useState } from 'react';
import { effectiveProvider, quickAsk } from '@/lib/ai/run';
import { aiErrorText } from '@/lib/ai/transport';
import { category } from '@/lib/categories';
import { addDays, isoDate, parseJst, uid, wallTime } from '@/lib/format';
import { distance, fmtDist } from '@/lib/geo';
import { fileToImage, parseLooseJson } from '@/lib/image';
import { mapApi } from '@/lib/map/instance';
import { searchText } from '@/lib/places';
import { geo } from '@/lib/store/geo';
import { delBlob, getBlob, putBlob } from '@/lib/store/idb';
import { toSaved } from '@/lib/store/places';
import { tripStore, useTrip } from '@/lib/store/trip';
import { toast, ui } from '@/lib/store/ui';
import type { PlaceSummary, Reservation, ReservationKind, SavedPlace } from '@/lib/types';
import { I } from '../Icons';
import { useObjectUrl } from '../hooks';
import { KIND_META } from '../panels/ReservationsPanel';
import { Dots, Seg } from '../ui';

type Draft = {
  kind: ReservationKind; title: string; date: string; time: string; endDate: string; endTime: string; people: string;
  confirmation: string; platform: string; price: string; note: string; status: Reservation['status']; place: SavedPlace | null;
};
type Photo = { id: string; blob?: Blob; fresh?: boolean };

const KINDS = Object.keys(KIND_META) as ReservationKind[];
const s = (v: unknown, n = 80) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !!parseJst(v);
const isTime = (v: string) => /^\d{2}:\d{2}$/.test(v);

function initDraft(r?: Reservation, pre?: Record<string, unknown>): Draft {
  if (r) {
    return {
      kind: r.kind, title: r.title, date: r.date, time: r.time || '', endDate: r.endDate || '', endTime: r.endTime || '', people: r.people ? String(r.people) : '',
      confirmation: r.confirmation || '', platform: r.platform || '', price: r.price || '', note: r.note || '', status: r.status, place: r.place || null,
    };
  }
  const p = pre || {};
  const kind = KINDS.includes(p.kind as ReservationKind) ? (p.kind as ReservationKind) : 'restaurant';
  const date = isDate(s(p.date, 10)) ? s(p.date, 10) : isoDate(new Date());
  return {
    kind, title: s(p.title), date, time: isTime(s(p.time, 5)) ? s(p.time, 5) : '',
    endDate: isDate(s(p.endDate, 10)) ? s(p.endDate, 10) : kind === 'hotel' ? addDays(date, 1) : '', endTime: '',
    people: typeof p.people === 'number' ? String(p.people) : '', confirmation: '', platform: '', price: '', note: '',
    status: p.status === 'pending' ? 'pending' : 'booked', place: (p.place as SavedPlace) || null,
  };
}

/** Fills the form from what the AI read on a confirmation screenshot. */
export function mergeScan(cur: Draft, j: Record<string, unknown>): Draft {
  const num = typeof j.people === 'number' ? j.people : Number(s(j.people, 4));
  const note = s(j.note, 300);
  return {
    ...cur,
    kind: KINDS.includes(j.kind as ReservationKind) ? (j.kind as ReservationKind) : cur.kind,
    title: s(j.title) || cur.title,
    date: isDate(s(j.date, 10)) ? s(j.date, 10) : cur.date,
    time: isTime(s(j.time, 5)) ? s(j.time, 5) : cur.time,
    endDate: isDate(s(j.end_date, 10)) ? s(j.end_date, 10) : cur.endDate,
    endTime: isTime(s(j.end_time, 5)) ? s(j.end_time, 5) : cur.endTime,
    people: Number.isFinite(num) && num > 0 && num < 100 ? String(Math.round(num)) : cur.people,
    confirmation: s(j.confirmation, 60) || cur.confirmation,
    platform: s(j.platform, 40) || cur.platform,
    price: s(j.price, 40) || cur.price,
    note: note && !cur.note.includes(note) ? [cur.note, note].filter(Boolean).join('\n') : cur.note,
    status: 'booked',
  };
}

function scanPrompt(): string {
  const y = wallTime(new Date()).year;
  return `이 사진은 여행 예약 확인서(이메일·앱 화면·바우처·영수증)야. 읽어서 JSON 하나만 출력해.
{"kind":"restaurant|hotel|activity|transport|rental|other","title":"가게·숙소·상품 이름 (원문 그대로)","date":"YYYY-MM-DD (숙소는 체크인 날짜)","time":"HH:MM (24시간, 현지 시각)","end_date":"YYYY-MM-DD (숙소 체크아웃·반납일)","end_time":"HH:MM","people":숫자,"confirmation":"예약번호","platform":"예약한 곳 (예: 타베로그, Booking.com, 클룩)","price":"금액과 통화 그대로","address":"주소","note":"취소 규정·준비물처럼 꼭 알아야 할 것 한두 줄 (한국어)"}
- 보이지 않는 값은 넣지 마. 지어내지 마.
- 연도가 없으면 ${y}년 이후 가장 가까운 날짜로.`;
}

function Thumb({ ph, onRemove, onOpen }: { ph: Photo; onRemove: () => void; onOpen: (url: string) => void }) {
  const [blob, setBlob] = useState<Blob | null>(ph.blob || null);
  useEffect(() => { if (!ph.blob) void getBlob(ph.id).then(b => setBlob(b || null)); }, [ph]);
  const url = useObjectUrl(blob);
  return (
    <div className="ph">
      {url && <img src={url} alt="확인서" onClick={() => onOpen(url)} />}
      <button type="button" onClick={onRemove} aria-label="사진 빼기"><I name="x" className="sm" /></button>
    </div>
  );
}

function PlacePicker({ value, onChange, hint }: { value: SavedPlace | null; onChange: (p: SavedPlace | null) => void; hint: string }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<PlaceSummary[] | null>(null);
  const find = async () => {
    const t = (q || hint).trim();
    if (!t) return;
    setBusy(true);
    try { setList((await searchText(t, geo().me || mapApi.center(), { limit: 5 })).places); } catch { toast('검색하지 못했어요'); } finally { setBusy(false); }
  };
  if (value) {
    return (
      <div className="fact" style={{ alignItems: 'center' }}>
        <I name="pin" /><span className="v">{value.name}{value.address && <><br /><span className="small muted">{value.address}</span></>}</span>
        <button type="button" className="btn sm" onClick={() => onChange(null)}>빼기</button>
      </div>
    );
  }
  const me = geo().me;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="hstack">
        <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder={hint ? `“${hint}” 또는 다른 이름` : '장소 이름 (길찾기에 써요)'} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void find(); } }} aria-label="장소 검색" />
        <button type="button" className="btn" onClick={() => void find()} disabled={busy}>{busy ? <Dots /> : '찾기'}</button>
      </div>
      {list && (list.length ? list.map(p => (
        <button type="button" key={p.id} className="sugg" onClick={() => { onChange(toSaved(p)); setList(null); }}>
          <span className="ico" style={{ color: category(p.category).color }}><I name={category(p.category).icon} /></span>
          <span style={{ minWidth: 0 }}><b>{p.name}</b><span>{p.address || category(p.category).label}</span></span>
          <span className="d">{me ? fmtDist(distance(me, p)) : ''}</span>
        </button>
      )) : <p className="hint">찾지 못했어요. 다른 이름으로 찾아 보세요.</p>)}
    </div>
  );
}

export default function ReservationForm({ id, prefill }: { id?: string; prefill?: Record<string, unknown> }) {
  const existing = useTrip(st => (id ? st.reservations.find(r => r.id === id) : undefined));
  const [f, setF] = useState<Draft>(() => initDraft(existing, prefill));
  const fRef = useRef(f);
  fRef.current = f;
  const [photos, setPhotos] = useState<Photo[]>(() => (existing?.photoIds || []).map(p => ({ id: p })));
  const [removed, setRemoved] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [more, setMore] = useState(!!existing);
  const scanRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Draft>) => setF(cur => ({ ...cur, ...patch }));

  useEffect(() => {
    if (prefill?.scan) { const t = setTimeout(() => scanRef.current?.click(), 120); return () => clearTimeout(t); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => ui().close('resForm');

  const addPhoto = async (file: File | undefined): Promise<{ b64: string; mime: string } | null> => {
    if (!file) return null;
    const r = await fileToImage(file, 1600, 0.85);
    if (!r) { toast('이 사진은 읽을 수 없어요'); return null; }
    setPhotos(p => [...p, { id: uid('ph'), blob: r.blob, fresh: true }].slice(0, 8));
    return r.img;
  };

  const scan = async (file: File | undefined) => {
    const img = await addPhoto(file);
    if (!img) return;
    if (!effectiveProvider()) { toast('AI 키가 없어서 사진만 붙였어요. 내용은 직접 넣어 주세요'); setMore(true); return; }
    setScanning(true);
    try {
      const raw = await quickAsk(scanPrompt(), { images: [img], json: true, fast: false, maxTokens: 900 });
      const j = parseLooseJson<Record<string, unknown>>(raw);
      if (!j) throw new Error('확인서에서 내용을 찾지 못했어요');
      setF(cur => mergeScan(cur, j));
      setMore(true);
      const where = [s(j.title), s(j.address, 160)].filter(Boolean).join(' ');
      if (!fRef.current.place && where) {
        try {
          const top = (await searchText(where, geo().me || mapApi.center(), { limit: 1 })).places[0];
          if (top) setF(cur => (cur.place ? cur : { ...cur, place: toSaved(top) }));
        } catch { /* place stays empty */ }
      }
      toast('확인서 내용을 채웠어요. 맞는지 확인해 주세요');
    } catch (e) {
      toast((e as Error)?.name === 'AiError' ? aiErrorText(e) : String((e as Error)?.message || e));
    } finally { setScanning(false); }
  };

  const save = async () => {
    const title = f.title.trim() || f.place?.name || '';
    if (!title) { toast('이름을 넣어 주세요'); return; }
    if (!isDate(f.date)) { toast('날짜를 확인해 주세요'); return; }
    setSaving(true);
    try {
      for (const ph of photos) if (ph.fresh && ph.blob) await putBlob(ph.id, ph.blob);
    } catch { toast('사진을 저장하지 못했어요 (저장 공간을 확인해 주세요)'); }
    removed.forEach(pid => void delBlob(pid));
    const people = Number(f.people);
    const rid = tripStore().upsertReservation({
      id: existing?.id,
      kind: f.kind, title, date: f.date,
      time: isTime(f.time) ? f.time : undefined,
      endDate: isDate(f.endDate) && f.endDate >= f.date ? f.endDate : undefined,
      endTime: isTime(f.endTime) ? f.endTime : undefined,
      people: Number.isFinite(people) && people > 0 ? Math.round(people) : undefined,
      confirmation: f.confirmation.trim() || undefined, platform: f.platform.trim() || undefined, price: f.price.trim() || undefined,
      note: f.note.trim() || undefined, place: f.place || undefined, photoIds: photos.map(p => p.id), status: f.status,
    });
    setSaving(false);
    toast(existing ? '수정했어요' : '예약함에 저장했어요');
    close();
    if (!existing) {
      const u = ui();
      if (u.tab !== 'booking') u.setTab('booking', 'half');
      ui().push({ type: 'reservation', id: rid });
    }
  };

  const hotel = f.kind === 'hotel';
  return (
    <div className="overlay" onClick={close}>
      <form className="modal" role="dialog" aria-label={existing ? '예약 수정' : '예약 추가'} onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); void save(); }}>
        <div className="modal-head">
          <h2>{existing ? '예약 수정' : '예약 추가'}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="닫기"><I name="x" /></button>
        </div>
        <div className="stack">
          <button type="button" className="btn sign block" onClick={() => scanRef.current?.click()} disabled={scanning}>
            {scanning ? <><Dots />AI가 확인서를 읽는 중…</> : <><I name="camera" />확인서 사진·캡처로 자동 채우기</>}
          </button>
          <div className="hstack wrap" style={{ gap: 6 }} role="group" aria-label="종류">
            {KINDS.map(k => <button type="button" key={k} className="chip flat" style={{ ['--c' as string]: KIND_META[k].color }} aria-pressed={f.kind === k} onClick={() => set({ kind: k, endDate: k === 'hotel' && !f.endDate ? addDays(f.date, 1) : f.endDate })}><I name={KIND_META[k].icon} />{KIND_META[k].label}</button>)}
          </div>
          <div className="field"><label htmlFor="rf-title">이름</label><input id="rf-title" className="input" value={f.title} onChange={e => set({ title: e.target.value.slice(0, 80) })} placeholder={hotel ? '예: 호텔 그레이서리 신주쿠' : '예: 스시 잔마이 / 시부야 스카이'} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div className="field"><label htmlFor="rf-date">{hotel ? '체크인' : '날짜'}</label><input id="rf-date" className="input" type="date" value={f.date} onChange={e => e.target.value && set({ date: e.target.value })} required /></div>
            <div className="field"><label htmlFor="rf-time">{hotel ? '체크인 시간' : '시간'}</label><input id="rf-time" className="input" type="time" value={f.time} onChange={e => set({ time: e.target.value })} /></div>
          </div>
          {(hotel || f.kind === 'rental') && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="field"><label htmlFor="rf-end">{hotel ? '체크아웃' : '반납일'}</label><input id="rf-end" className="input" type="date" value={f.endDate} min={f.date} onChange={e => set({ endDate: e.target.value })} /></div>
              <div className="field"><label htmlFor="rf-endt">{hotel ? '체크아웃 시간' : '반납 시간'}</label><input id="rf-endt" className="input" type="time" value={f.endTime} onChange={e => set({ endTime: e.target.value })} /></div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8 }}>
            <div className="field"><label htmlFor="rf-ppl">인원</label><input id="rf-ppl" className="input" type="number" inputMode="numeric" min={1} max={99} value={f.people} onChange={e => set({ people: e.target.value.slice(0, 2) })} /></div>
            <div className="field"><label htmlFor="rf-conf">예약번호</label><input id="rf-conf" className="input" value={f.confirmation} onChange={e => set({ confirmation: e.target.value.slice(0, 60) })} autoCapitalize="characters" /></div>
          </div>
          <div className="field"><span className="label">장소 (길찾기·지도 표시)</span><PlacePicker value={f.place} onChange={place => set({ place })} hint={f.title} /></div>
          {!more ? <button type="button" className="btn ghost block" onClick={() => setMore(true)}><I name="plus" />예약한 곳·금액·메모·사진</button> : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div className="field"><label htmlFor="rf-plat">예약한 곳</label><input id="rf-plat" className="input" value={f.platform} onChange={e => set({ platform: e.target.value.slice(0, 40) })} placeholder="예: 타베로그" /></div>
                <div className="field"><label htmlFor="rf-price">금액</label><input id="rf-price" className="input" value={f.price} onChange={e => set({ price: e.target.value.slice(0, 40) })} placeholder="예: ¥12,000 (현장 결제)" /></div>
              </div>
              <div className="field"><span className="label">상태</span><Seg value={f.status} onChange={v => set({ status: v })} options={[{ v: 'booked', label: '확정' }, { v: 'pending', label: '확정 대기' }, { v: 'cancelled', label: '취소됨' }]} label="예약 상태" /></div>
              <div className="field"><label htmlFor="rf-note">메모</label><textarea id="rf-note" className="textarea" value={f.note} onChange={e => set({ note: e.target.value.slice(0, 600) })} placeholder="취소 규정, 드레스코드, 주차 등" /></div>
              <div className="field">
                <span className="label">확인서 사진</span>
                <div className="photo-row">
                  {photos.map(ph => <Thumb key={ph.id} ph={ph} onOpen={url => ui().open({ type: 'photo', src: url })} onRemove={() => { setPhotos(p => p.filter(x => x.id !== ph.id)); if (!ph.fresh) setRemoved(r => [...r, ph.id]); }} />)}
                  {photos.length < 8 && <button type="button" className="add" onClick={() => addRef.current?.click()} aria-label="사진 추가"><I name="plus" /></button>}
                </div>
              </div>
            </>
          )}
          <button type="submit" className="btn primary lg block" disabled={saving}>{saving ? <Dots /> : existing ? '저장' : '예약함에 저장'}</button>
        </div>
        <input ref={scanRef} type="file" accept="image/*" hidden onChange={e => { void scan(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={addRef} type="file" accept="image/*" hidden onChange={e => { void addPhoto(e.target.files?.[0]); e.target.value = ''; }} />
      </form>
    </div>
  );
}
