'use client';

import { useEffect, useMemo, useState } from 'react';
import { fxRate } from '@/lib/ai/prompts';
import { distance, fmtDist, walkMinutes } from '@/lib/geo';
import { fmtDuration, fmtHM, fmtWon, isoDate, parseJst, wallTime, yenWithWon } from '@/lib/format';
import { googleDirections, taxiFareEstimate, uber, webSearch } from '@/lib/links';
import { mapApi } from '@/lib/map/instance';
import { localName } from '@/lib/places';
import { simpleRoute, transitRoutes, type SimpleRoute } from '@/lib/routes';
import { useGeo } from '@/lib/store/geo';
import { places } from '@/lib/store/places';
import { useRuntime } from '@/lib/store/runtime';
import { ui } from '@/lib/store/ui';
import type { SavedPlace, TransitLeg, TransitRoute } from '@/lib/types';
import { I } from '../Icons';
import { Dots, Empty, ExtLink, PanelHead, Seg } from '../ui';

type Mode = 'transit' | 'walk' | 'drive' | 'taxi';
type When = 'now' | 'depart' | 'arrive' | 'last';

const KIND_ICON: Record<TransitLeg['kind'], string> = { walk: 'walk', train: 'train', subway: 'train', shinkansen: 'train', bus: 'bus', flight: 'plane', ferry: 'route', other: 'route' };
const legColor = (l: TransitLeg) => l.color || (l.kind === 'shinkansen' ? '#1D5FD6' : l.kind === 'bus' ? '#178A4A' : l.kind === 'walk' ? undefined : '#4A525B');

function LegStrip({ r }: { r: TransitRoute }) {
  return (
    <div className="leg-strip">
      {r.legs.map((l, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <I name="chevron" className="sm" />}
          {l.kind === 'walk'
            ? <span className="leg-chip walk"><I name="walk" className="sm" />{l.minutes}분</span>
            : <span className="leg-chip" style={{ ['--c' as string]: legColor(l) }}><I name={KIND_ICON[l.kind]} className="sm" />{l.line || '열차'}</span>}
        </span>
      ))}
    </div>
  );
}

function Legs({ r, toName }: { r: TransitRoute; toName: string }) {
  return (
    <div className="legs">
      {r.legs.map((l, i) => (
        <div key={i} className={`leg${l.kind === 'walk' ? ' walk' : ''}`} style={{ ['--c' as string]: legColor(l) }}>
          <div className="tm">{l.fromTime || ''}</div>
          <div className="rail" />
          <div className="body">
            {l.kind === 'walk' ? (
              <>
                <b>{i === 0 ? '출발' : l.from}</b>
                <div className="info">도보 {l.minutes}분{l.distance ? ` · ${fmtDist(l.distance)}` : ''}{l.exitTo ? ` · ${l.exitTo} 출구 이용` : ''}</div>
              </>
            ) : (
              <>
                <b>{l.from}{l.numberingFrom && <span className="faint small"> ({l.numberingFrom})</span>}</b>
                <span className="ln" style={{ ['--c' as string]: legColor(l) }}><I name={KIND_ICON[l.kind]} className="sm" />{l.line}</span>
                <div className="info">
                  {l.direction && <>{l.direction} 방면 · </>}{l.platformFrom && <>{l.platformFrom} · </>}{l.minutes}분
                  {l.company && <> · {l.company}</>}
                </div>
                <div className="info">↓ {l.to} 하차{l.toTime ? ` ${l.toTime}` : ''}{l.platformTo ? ` (${l.platformTo})` : ''}{l.exitTo ? ` → ${l.exitTo} 출구` : ''}</div>
              </>
            )}
          </div>
        </div>
      ))}
      <div className="leg-end"><div className="tm">{r.arrival || ''}</div><span className="dot" /><span>{toName}</span></div>
    </div>
  );
}

export default function DirectionsPanel({ to, initialMode }: { to: SavedPlace; initialMode?: Mode }) {
  const me = useGeo(s => s.me);
  const config = useRuntime(s => s.config);
  const engine = useRuntime(s => s.engine);
  const [mode, setMode] = useState<Mode>(initialMode || 'transit');
  const [when, setWhen] = useState<When>('now');
  const [time, setTime] = useState(() => fmtHM(new Date(Date.now() + 15 * 60000)));
  const [routes, setRoutes] = useState<TransitRoute[] | null>(null);
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [simple, setSimple] = useState<SimpleRoute | null>(null);
  const [ja, setJa] = useState<{ name: string; address?: string } | null>(null);

  const from = me || mapApi.center();
  const fromLabel = me ? '내 위치' : '지도 중심';
  const straight = from ? distance(from, to) : null;
  const target = { lat: to.lat, lng: to.lng, name: to.name, placeId: to.placeId };
  const origin = me ? { lat: me.lat, lng: me.lng } : null;
  const rate = fxRate();

  useEffect(() => {
    if (!from) return;
    let alive = true;
    setErr(null);
    if (mode === 'transit') {
      if (!config?.transit) { setRoutes(null); return; }
      setLoading(true);
      let at = new Date();
      if (when === 'depart' || when === 'arrive') at = parseJst(isoDate(new Date()), time) || at;
      transitRoutes(from, to, at, when === 'now' ? 'depart' : when)
        .then(r => { if (!alive) return; setRoutes(r); setSel(0); setOpen(0); })
        .catch(e => { if (alive) { setRoutes([]); setErr((e as Error).message || '경로를 찾지 못했어요'); } })
        .finally(() => { if (alive) setLoading(false); });
    } else if (mode === 'walk' || mode === 'drive') {
      setLoading(true);
      simpleRoute(from, to, mode).then(r => { if (alive) setSimple(r); }).finally(() => { if (alive) setLoading(false); });
    }
    return () => { alive = false; };
  }, [mode, when, time, config?.transit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draw the selected route.
  useEffect(() => {
    if (mode === 'transit' && routes?.[sel]?.path?.length) places().setRoutes([{ id: 'transit', points: routes[sel].path!, color: '#0B5FB0', width: 6 }]);
    else if ((mode === 'walk' || mode === 'drive') && simple) places().setRoutes([{ id: mode, points: simple.path, color: mode === 'walk' ? '#2F6BFF' : '#111214', width: 6, dashed: simple.source === 'estimate' }]);
    else if (from) places().setRoutes([{ id: 'line', points: [from, to], color: '#111214', width: 3, dashed: true }]);
  }, [mode, routes, sel, simple]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (from) mapApi.fit([from, to], 16);
    if (mode === 'taxi' && !ja) void localName({ id: to.id, source: to.placeId ? 'google' : 'custom', placeId: to.placeId, name: to.name, nameLocal: to.nameLocal, lat: to.lat, lng: to.lng, category: to.category, address: to.address }).then(r => setJa(r || { name: to.nameLocal || to.name, address: to.address }));
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const lateNight = useMemo(() => { const h = wallTime(new Date()).hour; return h >= 22 || h < 5; }, []);
  const fare = straight != null ? taxiFareEstimate(straight, lateNight) : null;

  return (
    <div>
      <PanelHead title="길찾기" />
      <div className="dir-ends">
        <div className="end"><i />{fromLabel}{me ? <span className="faint small">±{Math.round(me.acc)}m</span> : null}</div>
        <div className="end to"><i /><span className="ellipsis">{to.name}</span>{straight != null && <span className="faint small num" style={{ marginLeft: 'auto' }}>직선 {fmtDist(straight)}</span>}</div>
      </div>
      <Seg<Mode> value={mode} onChange={setMode} label="이동 수단" options={[
        { v: 'transit', label: <><I name="train" className="sm" /> 대중교통</> }, { v: 'walk', label: <><I name="walk" className="sm" /> 도보</> },
        { v: 'drive', label: <><I name="car" className="sm" /> 차</> }, { v: 'taxi', label: <><I name="taxi" className="sm" /> 택시</> },
      ]} />
      <div style={{ height: 12 }} />
      {!from && <Empty icon="locate">내 위치를 아직 몰라요. 위치 권한을 켜거나 지도를 출발지로 옮겨 주세요.</Empty>}

      {from && mode === 'transit' && (
        config?.transit ? (
          <>
            <div className="hstack wrap" style={{ marginBottom: 10 }}>
              <Seg<When> value={when} onChange={setWhen} label="시간" options={[{ v: 'now', label: '지금' }, { v: 'depart', label: '출발' }, { v: 'arrive', label: '도착' }, { v: 'last', label: '막차' }]} />
              {(when === 'depart' || when === 'arrive') && <input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} style={{ width: 130, minHeight: 40 }} aria-label="시각" />}
            </div>
            {loading ? <div style={{ padding: 16 }}><Dots /></div> : err ? <Empty icon="alert">{err}</Empty> : routes && routes.length ? routes.map((r, i) => (
              <div key={i} className={`route-card${sel === i ? ' on' : ''}`} role="button" tabIndex={0} onClick={() => { setSel(i); setOpen(open === i ? -1 : i); }} onKeyDown={e => { if (e.key === 'Enter') { setSel(i); setOpen(open === i ? -1 : i); } }}>
                <div className="top">
                  <span className="mins">{fmtDuration(r.minutes)}</span>
                  <span className="times">{r.departure}–{r.arrival}</span>
                  <span className="small muted">환승 {r.transfers}회</span>
                  {r.fareIc != null && <span className="fare">{yenWithWon(r.fareIc, rate)}</span>}
                </div>
                <LegStrip r={r} />
                {open === i && <><Legs r={r} toName={to.name} />{r.fareTicket != null && r.fareTicket !== r.fareIc && <div className="small muted">승차권 {yenWithWon(r.fareTicket, rate)} · IC카드 {r.fareIc != null ? yenWithWon(r.fareIc, rate) : '-'}</div>}</>}
              </div>
            )) : <Empty icon="train">경로를 찾지 못했어요. 구글지도에서 확인해 보세요.</Empty>}
            <ExtLink href={googleDirections(target, 'transit', origin)} className="btn block" ><I name="ext" />구글지도에서 실시간 운행 정보 보기</ExtLink>
            <p className="tiny faint" style={{ marginTop: 8 }}>경로 데이터 NAVITIME · 운행 상황에 따라 달라질 수 있어요.</p>
          </>
        ) : (
          <div className="stack">
            <div className="card soft stack">
              <b>일본 열차 시각·요금은 구글지도 앱이 가장 정확해요</b>
              <span className="small muted">구글은 일본 대중교통 경로를 외부 앱에 제공하지 않아서, 버튼을 누르면 구글지도 앱이 바로 이 목적지로 열려요.</span>
              <ExtLink href={googleDirections(target, 'transit', origin)} className="btn sign lg block"><I name="train" />구글지도 대중교통 길찾기</ExtLink>
            </div>
            <button className="btn block" onClick={() => ui().ask(`지금 위치에서 ${to.name}${to.nameLocal ? `(${to.nameLocal})` : ''}까지 전철로 가는 법 알려줘. 노선, 타는 방향, 갈아타는 곳, 출구, 예상 시간과 요금까지.`)}><I name="ai" />AI에게 노선 설명 받기</button>
            {straight != null && straight < 1500 && <p className="small muted">걸어서 {walkMinutes(straight)}분 거리예요. 도보가 더 빠를 수 있어요.</p>}
          </div>
        )
      )}

      {from && (mode === 'walk' || mode === 'drive') && (
        <div className="stack">
          {loading || !simple ? <Dots /> : (
            <div className="card soft">
              <div className="hstack"><span style={{ fontSize: 24, fontWeight: 800 }} className="num">{fmtDuration(simple.minutes)}</span><span className="muted num">{fmtDist(simple.meters)}</span></div>
              <div className="tiny faint" style={{ marginTop: 4 }}>{simple.source === 'google' ? 'Google 경로' : engine === 'google' ? '직선거리 기준 추정' : '직선거리 기준 추정 (무료 지도)'}</div>
              {simple.steps && simple.steps.length > 0 && <ol className="small" style={{ margin: '10px 0 0', paddingLeft: 20 }}>{simple.steps.slice(0, 12).map((s, i) => <li key={i}>{s}</li>)}</ol>}
            </div>
          )}
          <ExtLink href={googleDirections(target, mode === 'walk' ? 'walking' : 'driving', origin)} className="btn primary lg block"><I name="dir" />구글지도 {mode === 'walk' ? '도보' : '내비'} 시작</ExtLink>
          {mode === 'walk' && <button className="btn sign block" onClick={() => ui().open({ type: 'camera' })}><I name="camera" />카메라로 길안내 (복잡한 역·지하)</button>}
          {mode === 'walk' && <p className="tiny faint">구글지도 도보 안내의 ‘라이브 뷰’를 누르면 AR 화살표가 나와요. 도에이 지하철 일부 역은 실내에서도 돼요.</p>}
        </div>
      )}

      {from && mode === 'taxi' && fare && (
        <div className="stack">
          <div className="taxi-card">
            <span className="small muted">예상 택시 요금 {lateNight ? '(심야 20% 할증 포함)' : ''}</span>
            <span className="yen">¥{fare.low.toLocaleString()} ~ ¥{fare.high.toLocaleString()}</span>
            <span className="small muted">약 {fmtWon(fare.low * rate)} ~ {fmtWon(fare.high * rate)} · 도쿄 요금 기준 대략치</span>
          </div>
          <button className="btn sign lg block" onClick={() => ui().open({ type: 'bigtext', ja: ja?.name || to.nameLocal || to.name, ko: to.name, addr: ja?.address || to.address, lead: 'ここまでお願いします' })}><I name="big" />택시 기사에게 보여주기</button>
          <ExtLink href={uber(target)} className="btn block"><I name="taxi" />Uber로 부르기 (일본 택시 연결)</ExtLink>
          <ExtLink href={webSearch('GO タクシーアプリ')} className="btn block"><I name="ext" />GO 택시 앱 (일본 최대 택시 앱)</ExtLink>
          <p className="tiny faint">일본 택시는 뒷문이 자동으로 열리고 닫혀요. 카드·교통카드 결제가 되는 차가 많지만 현금을 조금 챙기세요.</p>
        </div>
      )}
    </div>
  );
}
