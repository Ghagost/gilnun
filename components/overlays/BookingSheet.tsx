'use client';

import { useEffect, useMemo, useState } from 'react';
import { effectiveProvider, quickAsk } from '@/lib/ai/run';
import { aiErrorText } from '@/lib/ai/transport';
import { addDays, daysBetween, isoDate, parseJst, wallTime } from '@/lib/format';
import { parseLooseJson } from '@/lib/image';
import { bookingKindFor, bookingOptions, tel, type BookingKind } from '@/lib/links';
import { localName } from '@/lib/places';
import { speak } from '@/lib/speech';
import { toSaved, usePlaces } from '@/lib/store/places';
import { useTrip } from '@/lib/store/trip';
import { toast, ui } from '@/lib/store/ui';
import type { ReservationKind } from '@/lib/types';
import { I } from '../Icons';
import { Dots, Empty, ExtLink } from '../ui';

const KINDS: { v: BookingKind; label: string; icon: string }[] = [
  { v: 'restaurant', label: '식당', icon: 'food' },
  { v: 'hotel', label: '숙소', icon: 'bed' },
  { v: 'activity', label: '입장권·투어', icon: 'torii' },
  { v: 'rental', label: '렌터카', icon: 'car' },
  { v: 'train', label: '열차', icon: 'train' },
  { v: 'other', label: '기타', icon: 'ticket' },
];
const RES_KIND: Record<BookingKind, ReservationKind> = { restaurant: 'restaurant', hotel: 'hotel', activity: 'activity', rental: 'rental', train: 'transport', other: 'other' };
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const NAME_KEY = 'gilnun.bookName';

export function jaDate(date: string): string {
  const d = parseJst(date);
  if (!d) return '';
  const w = wallTime(d);
  return `${w.month}月${w.day}日（${WD[w.weekday]}）`;
}
export function jaTime(t?: string): string {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return '';
  const h = Number(t.slice(0, 2)), m = Number(t.slice(3));
  return `${h}時${m ? `${m}分` : ''}`;
}

export type ScriptLine = { ja: string; ko: string; read?: string };

/** A polite Japanese phone script for the booking (works without AI). */
export function phoneScript(kind: BookingKind, o: { date: string; time?: string; checkout?: string; people: number; name?: string }): ScriptLine[] {
  const when = jaDate(o.date);
  const koWhen = o.date.slice(5).replace('-', '/');
  const lines: ScriptLine[] = [{ ja: 'もしもし、予約をお願いしたいのですが。', ko: '여보세요, 예약하고 싶은데요.' }];
  if (kind === 'hotel') {
    const n = o.checkout ? Math.max(1, daysBetween(o.date, o.checkout)) : 1;
    lines.push({ ja: `${when}から${n}泊、${o.people}名で泊まりたいのですが、空いている部屋はありますか？`, ko: `${koWhen}부터 ${n}박, ${o.people}명 묵고 싶은데 빈 방 있나요?` });
  } else if (kind === 'restaurant') {
    lines.push({ ja: `${when}の${jaTime(o.time) || '夜'}に、${o.people}名で予約できますか？`, ko: `${koWhen} ${o.time || '저녁'}에 ${o.people}명 예약 가능할까요?` });
    lines.push({ ja: 'もし空いていなければ、ほかの時間でも大丈夫です。', ko: '안 되면 다른 시간도 괜찮아요.' });
  } else if (kind === 'rental') {
    lines.push({ ja: `${when}${o.time ? `の${jaTime(o.time)}` : ''}から車を借りたいのですが、空いていますか？`, ko: `${koWhen} ${o.time || ''}부터 차를 빌리고 싶은데 가능할까요?` });
  } else {
    lines.push({ ja: `${when}${o.time ? `の${jaTime(o.time)}` : ''}に${o.people}名で予約したいのですが、可能ですか？`, ko: `${koWhen} ${o.time || ''} ${o.people}명 예약하고 싶은데 가능할까요?` });
  }
  lines.push({ ja: `名前は${o.name?.trim() || '〇〇'}です。`, ko: `이름은 ${o.name?.trim() || '○○'}입니다.` });
  lines.push({ ja: '日本語があまり話せないので、ゆっくり話していただけますか？', ko: '일본어를 잘 못해서 천천히 말씀해 주시겠어요?' });
  lines.push({ ja: '英語は話せますか？', ko: '(막히면) 영어 하실 수 있나요?' });
  lines.push({ ja: 'ありがとうございます。よろしくお願いします。', ko: '감사합니다. 잘 부탁드립니다.' });
  return lines;
}

function defaultDate(): string {
  const today = isoDate(new Date());
  const ts = useTrip.getState();
  const trip = ts.trips.find(t => t.id === ts.activeTripId) || ts.trips.find(t => t.end >= today);
  if (trip && trip.end >= today) return trip.start > today ? trip.start : today;
  return today;
}

export default function BookingSheet({ placeId }: { placeId: string }) {
  const p = usePlaces(s => s.byId[placeId]);
  const [kind, setKind] = useState<BookingKind>(() => bookingKindFor(p?.category));
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('19:00');
  const [checkout, setCheckout] = useState(() => addDays(defaultDate(), 1));
  const [people, setPeople] = useState(2);
  const [name, setName] = useState(() => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } });
  const [ja, setJa] = useState<string | null>(p?.nameLocal || null);
  const [script, setScript] = useState<ScriptLine[] | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    if (!p || p.nameLocal || p.source !== 'google') return;
    let alive = true;
    void localName(p).then(r => { if (alive && r?.name) setJa(r.name); }).catch(() => {});
    return () => { alive = false; };
  }, [p]);
  useEffect(() => { try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ } }, [name]);
  useEffect(() => { if (checkout <= date) setCheckout(addDays(date, 1)); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setScript(null); }, [kind, date, time, checkout, people, name]);

  const opts = useMemo(() => (p ? bookingOptions(kind, { name: p.name, nameJa: ja || p.nameLocal, placeId: p.placeId, lat: p.lat, lng: p.lng, website: p.website }, { date, time: kind === 'restaurant' ? time : undefined, checkout: kind === 'hotel' ? checkout : undefined, people }) : []), [p, kind, ja, date, time, checkout, people]);
  const base = useMemo(() => phoneScript(kind, { date, time: kind === 'restaurant' || kind === 'rental' ? time : undefined, checkout, people, name }), [kind, date, time, checkout, people, name]);
  const lines = script || base;

  const close = () => ui().close('booking');
  if (!p) return (
    <div className="overlay" onClick={close}><div className="modal" onClick={e => e.stopPropagation()}><Empty>장소 정보를 찾을 수 없어요.</Empty></div></div>
  );

  const phone = tel(p.phone);
  const withReading = async () => {
    if (!effectiveProvider()) { toast('AI 키가 있어야 발음을 달 수 있어요'); return; }
    setAiBusy(true);
    try {
      const raw = await quickAsk(`다음 일본어 전화 대본의 각 줄에 한국어 발음(한글로 소리 나는 대로)을 달아 줘. 일본어는 바꾸지 마.
JSON 하나만: {"lines":[{"ja":"원문","read":"한글 발음"}]}

${base.map(l => l.ja).join('\n')}`, { json: true, maxTokens: 1200 });
      const j = parseLooseJson<{ lines?: { ja?: string; read?: string }[] }>(raw);
      const reads = j?.lines || [];
      setScript(base.map((l, i) => ({ ...l, read: reads.find(r => r.ja === l.ja)?.read || reads[i]?.read })));
    } catch (e) { toast(aiErrorText(e)); } finally { setAiBusy(false); }
  };

  const saveAsReservation = () => {
    close();
    ui().open({
      type: 'resForm',
      prefill: {
        kind: RES_KIND[kind], title: p.name, date, time: kind === 'restaurant' || kind === 'rental' ? time : undefined,
        endDate: kind === 'hotel' ? checkout : undefined, people, place: toSaved(p), status: 'pending',
      },
    });
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="modal" role="dialog" aria-label="예약하기" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>예약하기</h2>
          <button className="icon-btn" onClick={close} aria-label="닫기"><I name="x" /></button>
        </div>
        <div className="stack">
          <div>
            <b style={{ fontSize: 17 }}>{p.name}</b>
            {ja && ja !== p.name && <div className="small muted" lang="ja">{ja}</div>}
          </div>
          <div className="hstack wrap" style={{ gap: 6 }} role="group" aria-label="예약 종류">
            {KINDS.map(k => <button key={k.v} className="chip flat" aria-pressed={kind === k.v} onClick={() => setKind(k.v)}><I name={k.icon} />{k.label}</button>)}
          </div>
          {kind !== 'train' && (
            <div style={{ display: 'grid', gridTemplateColumns: kind === 'hotel' ? '1fr 1fr 64px' : '1fr 124px 64px', gap: 8 }}>
              <div className="field"><label htmlFor="bk-date">{kind === 'hotel' ? '체크인' : '날짜'}</label><input id="bk-date" className="input" type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} /></div>
              {kind === 'hotel'
                ? <div className="field"><label htmlFor="bk-out">체크아웃</label><input id="bk-out" className="input" type="date" value={checkout} min={addDays(date, 1)} onChange={e => e.target.value && setCheckout(e.target.value)} /></div>
                : <div className="field"><label htmlFor="bk-time">시간</label><input id="bk-time" className="input" type="time" step={900} value={time} onChange={e => e.target.value && setTime(e.target.value)} /></div>}
              <div className="field"><label htmlFor="bk-ppl">인원</label><input id="bk-ppl" className="input" type="number" inputMode="numeric" min={1} max={30} value={people} onChange={e => setPeople(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} /></div>
            </div>
          )}
          <div>
            <h3 className="sec" style={{ marginTop: 4 }}>여기서 예약하세요</h3>
            {opts.map(o => (
              <ExtLink key={o.id} href={o.url} className={`book-opt${o.primary ? ' primary' : ''}`}>
                <span><b>{o.label}</b><span>{o.sub}</span></span><I name="ext" />
              </ExtLink>
            ))}
            <p className="hint">길눈은 예약 사이트로 날짜·인원을 넘겨 줄 뿐, 결제나 예약을 대신하지 않아요. 예약을 마치면 아래 버튼으로 예약함에 저장하세요.</p>
          </div>
          {kind !== 'train' && (
            <div>
              <h3 className="sec">{phone ? '전화로 예약' : '전화·직접 예약할 때'}</h3>
              <div className="field" style={{ marginBottom: 8 }}>
                <label htmlFor="bk-name">예약자 이름 (영문이나 가타카나)</label>
                <input id="bk-name" className="input" value={name} onChange={e => setName(e.target.value.slice(0, 40))} placeholder="예: KIM / キム" autoComplete="name" />
              </div>
              <div className="script" lang="ja">
                {lines.map((l, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <b>{l.ja}</b>
                    {l.read && <div className="small" style={{ color: 'var(--link)' }}>{l.read}</div>}
                    <div className="small muted" lang="ko">{l.ko}</div>
                  </div>
                ))}
              </div>
              <div className="hstack wrap" style={{ gap: 6, marginTop: 8 }}>
                {phone && <a className="btn primary" href={phone}><I name="phone" />전화 걸기</a>}
                <button className="btn" onClick={() => void speak(lines.slice(0, 3).map(l => l.ja).join(''), 'ja-JP', 0.9)}><I name="sound" />들어보기</button>
                <button className="btn" onClick={() => ui().open({ type: 'bigtext', lead: '予約をお願いします', ja: lines[1].ja, ko: lines[1].ko, addr: name ? `名前: ${name}` : undefined })}><I name="big" />직원에게 보여주기</button>
                {!script && <button className="btn" onClick={() => void withReading()} disabled={aiBusy}>{aiBusy ? <Dots /> : <><I name="ai" />한글 발음 달기</>}</button>}
              </div>
            </div>
          )}
          <button className="btn sign lg block" onClick={saveAsReservation}><I name="check" />예약했어요 · 예약함에 저장</button>
        </div>
      </div>
    </div>
  );
}
