'use client';

import { useEffect, useMemo, useState } from 'react';
import { category } from '@/lib/categories';
import { setDestination, startDirections } from '@/lib/actions';
import { bearing, dirKo, distance, fmtDist, walkMinutes } from '@/lib/geo';
import { isoDate, wallTime } from '@/lib/format';
import { arrivalWarning, statusAt, statusLabel, weekdayLines } from '@/lib/hours';
import { googleDirections, googlePlace, tel } from '@/lib/links';
import { localName, placeDetails } from '@/lib/places';
import { useGeo } from '@/lib/store/geo';
import { places, toSaved, usePlaces } from '@/lib/store/places';
import { useRuntime } from '@/lib/store/runtime';
import { useSettings } from '@/lib/store/settings';
import { useTrip, tripStore } from '@/lib/store/trip';
import { toast, ui } from '@/lib/store/ui';
import type { PlaceDetails } from '@/lib/types';
import { I } from '../Icons';
import { Dots, Empty, ExtLink, PanelHead, Price, Stars } from '../ui';

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast('복사했어요'); } catch { toast('복사하지 못했어요'); }
}

export default function PlacePanel({ id }: { id: string }) {
  const p = usePlaces(s => s.byId[id]);
  const ref = usePlaces(s => s.refOf[id]);
  const dest = usePlaces(s => s.dest);
  const me = useGeo(s => s.me);
  const engine = useRuntime(s => s.engine);
  const dataSaver = useSettings(s => s.dataSaver);
  const saved = useTrip(s => !!s.saved[id]);
  const [d, setD] = useState<PlaceDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [ja, setJa] = useState<{ name: string; address?: string } | null>(null);
  const [showHours, setShowHours] = useState(false);
  const [showOrig, setShowOrig] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!p) return;
    let alive = true;
    setLoading(true);
    placeDetails(p).then(r => {
      if (!alive) return;
      setD(r);
      places().update(id, { ...r, photo: r.photo ?? p.photo });
    }).catch(() => { if (alive) setD({ ...p, fetchedAt: Date.now() }); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const info = d || (p ? { ...p, fetchedAt: 0 } : null);
  const dist = info && me ? distance(me, info) : info?.distance;
  const st = useMemo(() => (info?.hours ? statusLabel(statusAt(info.hours, new Date(), info.utcOffset ?? 540)) : null), [info]);
  const warn = info?.hours && dist != null ? arrivalWarning(info.hours, walkMinutes(dist), new Date(), info.utcOffset ?? 540) : null;

  if (!p || !info) return <div><PanelHead title="장소" /><Empty>장소 정보를 찾을 수 없어요.</Empty></div>;

  const C = category(info.category);
  const isDest = dest?.id === id;
  const todayIdx = wallTime(new Date(), info.utcOffset ?? 540).weekday;
  const lines = info.weekdayText?.length ? info.weekdayText : weekdayLines(info.hours);
  const target = { lat: info.lat, lng: info.lng, name: info.name, placeId: info.placeId };

  const getJa = async () => {
    if (ja) return ja;
    const r = await localName(info).catch(() => null);
    const v = r || { name: info.nameLocal || info.name, address: info.address };
    setJa(v);
    return v;
  };
  const showBig = async () => {
    const v = await getJa();
    ui().open({ type: 'bigtext', ja: v.name, ko: info.name, addr: v.address || info.address, lead: 'ここに行きたいです' });
  };
  const addToTrip = () => {
    const ts = tripStore();
    const trip = ts.trips.find(t => t.id === ts.activeTripId) || ts.trips[0];
    if (!trip) { ui().open({ type: 'tripForm' }); toast('먼저 여행 일정을 만들어 주세요'); return; }
    const iso = isoDate(new Date());
    const day = trip.days.find(x => x.date === iso)?.date || trip.days[0].date;
    ts.addStop(trip.id, day, toSaved(info));
    toast(`“${trip.title}” ${day.slice(5).replace('-', '/')}에 추가했어요`);
  };
  const share = async () => {
    const url = info.googleMapsUri || googlePlace(target);
    const text = `${info.name}${info.nameLocal ? ` (${info.nameLocal})` : ''}\n${info.address || ''}`;
    try { if (navigator.share) { await navigator.share({ title: info.name, text, url }); return; } } catch { return; }
    void copy(`${text}\n${url}`);
  };

  const photos = engine === 'google' && !dataSaver ? (info.photos?.length ? info.photos : info.photo ? [info.photo] : []) : [];
  const feats: string[] = [];
  if (info.payment?.cashOnly) feats.push('💴 현금만');
  else if (info.payment?.card) feats.push('💳 카드 가능');
  if (info.payment?.nfc) feats.push('📱 교통카드·터치결제');
  if (info.reservable) feats.push('📅 예약 가능');
  if (info.dining?.takeout) feats.push('🥡 포장');
  if (info.dining?.vegetarian) feats.push('🥗 채식 메뉴');
  if (info.dining?.groups) feats.push('👥 단체');
  if (info.dining?.kids) feats.push('👶 아이 동반');
  if (info.access?.entrance) feats.push('♿ 휠체어 입구');
  if (info.dining?.beer || info.dining?.wine) feats.push('🍺 주류');

  return (
    <div>
      <PanelHead title={<span className="p-kind" style={{ ['--c' as string]: C.color }}><I name={C.icon} />{info.typeLabel || C.label}{ref && <span className="badge" style={{ ['--c' as string]: C.color }}>{ref.slice(1)}</span>}</span>} />
      {photos.length > 0 && (
        <div className="gallery" data-nodrag>
          {photos.slice(0, 8).map((ph, i) => {
            const src = ph.url(720);
            return src ? (
              <figure key={i}>
                <img src={src} alt={`${info.name} 사진 ${i + 1}`} loading={i ? 'lazy' : 'eager'} referrerPolicy="no-referrer" onClick={() => ui().open({ type: 'photo', src: ph.url(1600), caption: ph.author ? `사진: ${ph.author}` : undefined })} />
                {ph.author && <figcaption>{ph.authorUri ? <a href={ph.authorUri} target="_blank" rel="noopener noreferrer">{ph.author}</a> : ph.author}</figcaption>}
              </figure>
            ) : null;
          })}
        </div>
      )}
      <h1 className="p-name">{info.name}</h1>
      <div className="p-ja">
        {(ja?.name || info.nameLocal) ? (
          <>
            <span className="ja" lang="ja">{ja?.name || info.nameLocal}</span>
            <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => copy(ja?.name || info.nameLocal || '')} aria-label="일본어 이름 복사"><I name="copy" className="sm" /></button>
          </>
        ) : info.placeId ? <button className="btn link" style={{ padding: 0, minHeight: 28 }} onClick={() => void getJa()}>日本語 이름 보기</button> : null}
      </div>
      <div className="p-line">
        <Stars rating={info.rating} count={info.ratingCount} />
        <Price level={info.priceLevel} />
        {info.businessStatus === 'CLOSED_PERMANENTLY' ? <span className="pill bad">폐업</span> : info.businessStatus === 'CLOSED_TEMPORARILY' ? <span className="pill bad">임시 휴업</span>
          : st && st.tone !== 'unknown' && <span className={`tone-${st.tone}`} style={{ fontWeight: 650 }}>{st.text}</span>}
        {dist != null && <span className="num">{fmtDist(dist)} · 도보 {walkMinutes(dist)}분{me ? ` · ${dirKo(bearing(me, info))}쪽` : ''}</span>}
      </div>
      {info.rating != null && info.source !== 'osm' && <p className="tiny faint" style={{ margin: '4px 0 0' }}>일본 구글 평점은 박한 편이라 3.5 이상이면 괜찮고 4.0 이상이면 인기 있는 곳이에요.</p>}
      {warn && <div className="p-warn"><I name="clock" />{warn}</div>}

      <div className="actions">
        <button className="act primary" onClick={() => startDirections(info)}><I name="route" />길찾기</button>
        <button className={`act${saved ? ' on' : ''}`} onClick={() => { const on = tripStore().toggleSaved(toSaved(info)); toast(on ? '저장했어요' : '저장을 취소했어요'); }} aria-pressed={saved}><I name="bookmark" />{saved ? '저장됨' : '저장'}</button>
        <button className="act" onClick={addToTrip}><I name="calendar" />일정 추가</button>
        <button className="act sign" onClick={() => ui().open({ type: 'booking', placeId: id })}><I name="ticket" />예약</button>
        <button className="act" onClick={share}><I name="share" />공유</button>
      </div>
      <div className="hstack wrap" style={{ gap: 6, margin: '8px 0 4px' }}>
        <button className="btn sm" onClick={() => { setDestination(info); ui().open({ type: 'camera' }); }}><I name="camera" />카메라 길안내</button>
        <button className="btn sm" onClick={() => ui().ask(`${info.name}${info.nameLocal ? `(${info.nameLocal})` : ''} [${ref}]은 어떤 곳이야? 지금 위치에서 가는 법이랑 알아두면 좋은 팁도 알려줘.`)}><I name="ai" />AI에게 묻기</button>
        <button className="btn sm" onClick={() => void showBig()}><I name="big" />직원에게 보여주기</button>
        {!isDest && <button className="btn sm" onClick={() => setDestination(info)}><I name="flag" />목적지로</button>}
      </div>

      {info.note && <div className="ai-sum" style={{ marginTop: 10 }}><b className="small">AI 메모</b><br />{info.note}</div>}
      {(info.reviewSummary || info.editorial) && (
        <div className="ai-sum" style={{ marginTop: 10 }}>
          {info.reviewSummary || info.editorial}
          {info.reviewSummary && <div className="tiny faint" style={{ marginTop: 4 }}>Google 리뷰 요약</div>}
        </div>
      )}

      <div className="facts">
        {(info.address || ja?.address) && (
          <button className="fact" onClick={() => copy(ja?.address || info.address || '')}>
            <I name="pin" /><span className="v">{info.address}{ja?.address && ja.address !== info.address && <><br /><span className="ja small muted" lang="ja">{ja.address}</span></>}</span><I name="copy" className="sm" />
          </button>
        )}
        {(lines.length > 0 || info.hoursRaw) && (
          <button className="fact" onClick={() => setShowHours(!showHours)} aria-expanded={showHours}>
            <I name="clock" />
            <span className="v">
              {st ? <span className={`tone-${st.tone}`} style={{ fontWeight: 650 }}>{st.text}</span> : '영업시간'}
              {showHours && (
                <span className="hours-lines">
                  {lines.length ? lines.map((l, i) => {
                    const isToday = info.weekdayText?.length ? i === (todayIdx + 6) % 7 : l.startsWith(DAY_KO[todayIdx]);
                    return <span key={i} className={isToday ? 'today' : ''}>{l}</span>;
                  }) : <span>{info.hoursRaw}</span>}
                </span>
              )}
            </span>
            <I name={showHours ? 'up' : 'down'} className="sm" />
          </button>
        )}
        {info.phone && (
          <a className="fact" href={tel(info.phone) || '#'}>
            <I name="phone" /><span className="v num">{info.phone}</span><span className="small muted">전화</span>
          </a>
        )}
        {info.website && (
          <ExtLink href={info.website} className="fact"><I name="globe" /><span className="v ellipsis">{info.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span><I name="ext" className="sm" /></ExtLink>
        )}
        <ExtLink href={info.googleMapsUri || googlePlace(target)} className="fact"><I name="map" /><span className="v">구글지도에서 보기 (사진·리뷰 더 보기)</span><I name="ext" className="sm" /></ExtLink>
        <ExtLink href={googleDirections(target, 'transit')} className="fact"><I name="train" /><span className="v">구글지도 대중교통 길찾기</span><I name="ext" className="sm" /></ExtLink>
      </div>
      {feats.length > 0 && <div className="feats">{feats.map(f => <span key={f} className="pill">{f}</span>)}</div>}

      {loading && !d && <div style={{ padding: '10px 0' }}><Dots /></div>}
      {info.reviews && info.reviews.length > 0 && (
        <>
          <h3 className="sec">리뷰</h3>
          <div className="reviews">
            {info.reviews.map((r, i) => (
              <div key={i} className="review">
                <div className="who">
                  {r.authorPhoto && <img src={r.authorPhoto} alt="" referrerPolicy="no-referrer" />}
                  {r.authorUri ? <a href={r.authorUri} target="_blank" rel="noopener noreferrer">{r.author}</a> : <span>{r.author}</span>}
                  {r.rating != null && <span className="stars">★ {r.rating}</span>}
                  {r.when && <span className="faint">{r.when}</span>}
                </div>
                <p>{showOrig[i] && r.original ? r.original : r.text}</p>
                {r.original && <button className="btn link" style={{ padding: 0, minHeight: 26, fontSize: 12.5 }} onClick={() => setShowOrig({ ...showOrig, [i]: !showOrig[i] })}>{showOrig[i] ? '번역 보기' : '원문 보기'}</button>}
              </div>
            ))}
          </div>
        </>
      )}
      <div className="attrib">{info.source === 'osm' || info.source === 'geo' ? '© OpenStreetMap 기여자' : 'Google 지도 데이터'}{info.attributions?.map(a => ` · ${a.name}`)}</div>
    </div>
  );
}
