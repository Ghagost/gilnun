'use client';

import { useMemo } from 'react';
import { mapApi } from '@/lib/map/instance';
import { effectiveProvider } from '@/lib/ai/run';
import { PROVIDER_LABEL } from '@/lib/ai/types';
import { fmtHM, isoDate, parseJst } from '@/lib/format';
import { restartGeo } from '@/lib/sensors';
import { useGeo } from '@/lib/store/geo';
import { useRuntime } from '@/lib/store/runtime';
import { useSettings } from '@/lib/store/settings';
import { useTrip } from '@/lib/store/trip';
import { ui } from '@/lib/store/ui';
import { I } from '../Icons';
import { useNow } from '../hooks';
import { weatherIcon, weatherText } from '../ui';

const JUMPS: [string, string, number, number][] = [
  ['도쿄역', '東京駅', 35.6812, 139.7671], ['신주쿠', '新宿', 35.6896, 139.7006], ['시부야', '渋谷', 35.658, 139.7016],
  ['아사쿠사', '浅草', 35.7118, 139.7966], ['긴자', '銀座', 35.6717, 139.765], ['하네다공항', '羽田空港', 35.5494, 139.7798],
  ['나리타공항', '成田空港', 35.772, 140.3929], ['난바', '難波', 34.6659, 135.5013], ['우메다', '梅田', 34.7025, 135.4959],
  ['간사이공항', '関西空港', 34.432, 135.2304], ['교토역', '京都駅', 34.9858, 135.7588], ['나고야역', '名古屋駅', 35.1709, 136.8815],
  ['후쿠오카 하카타', '博多', 33.5902, 130.4207], ['삿포로', '札幌', 43.0687, 141.3508],
];

const EXAMPLES = [
  '근처에 지금 문 연 라멘집 추천해줘',
  '여기서 시부야역 가는 제일 쉬운 방법',
  '간사이공항에서 난바까지 가는 법이랑 요금',
  '짐 맡길 코인로커 찾아줘',
  '오늘 비 오면 갈 만한 실내 명소',
  '오사카 3박4일 일정 짜서 일정에 넣어줘',
];

export default function HomePanel() {
  const me = useGeo(s => s.me);
  const geoError = useGeo(s => s.error);
  const area = useGeo(s => s.area);
  const config = useRuntime(s => s.config);
  const googleState = useRuntime(s => s.googleState);
  const engine = useRuntime(s => s.engine);
  const weather = useRuntime(s => s.weather);
  const online = useRuntime(s => s.online);
  const keys = useSettings(s => s.keys);
  const trips = useTrip(s => s.trips);
  const activeTripId = useTrip(s => s.activeTripId);
  const reservations = useTrip(s => s.reservations);
  const now = useNow(60000);
  const provider = useMemo(() => effectiveProvider(), [config, keys]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = isoDate(new Date(now));
  const nextRes = useMemo(() => reservations
    .filter(r => r.status !== 'cancelled' && (r.date > today || (r.date === today && (!r.time || (parseJst(r.date, r.time)?.getTime() ?? 0) > now - 30 * 60000))))
    .sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')))[0], [reservations, today, now]);
  const trip = trips.find(t => t.id === activeTripId && t.start <= today && t.end >= today) || trips.find(t => t.start <= today && t.end >= today);
  const todayStops = trip?.days.find(d => d.date === today)?.stops || [];

  const rows: { tone: 'ok' | 'warn' | 'bad'; icon: string; text: string; action?: { label: string; run: () => void } }[] = [];
  if (geoError === 'denied') rows.push({ tone: 'bad', icon: 'locate', text: '위치 권한이 꺼져 있어요. 주소창 왼쪽 아이콘 → 권한에서 위치를 허용해 주세요.', action: { label: '다시 시도', run: restartGeo } });
  else if (geoError === 'insecure') rows.push({ tone: 'bad', icon: 'alert', text: 'https 주소로 열어야 위치·카메라를 쓸 수 있어요.' });
  else if (!me) rows.push({ tone: 'warn', icon: 'locate', text: '내 위치를 찾는 중이에요…' });
  if (!provider) rows.push({ tone: 'warn', icon: 'ai', text: 'AI 키가 아직 없어요. 지도·검색·일정·예약은 지금도 다 돼요.', action: { label: '키 넣기', run: () => { ui().setTab('tools'); ui().push({ type: 'settings', section: 'ai' }); } } });
  if (googleState === 'error') rows.push({ tone: 'warn', icon: 'map', text: '구글 지도를 불러오지 못해 무료 지도로 보여주고 있어요.', action: { label: '진단', run: () => { ui().setTab('tools'); ui().push({ type: 'diagnostics' }); } } });
  if (!online) rows.push({ tone: 'warn', icon: 'wifioff', text: '오프라인 — 저장한 일정·예약·회화 카드는 쓸 수 있어요.' });

  return (
    <div className="stack" style={{ paddingTop: 2 }}>
      <button className="ask-bar" onClick={() => ui().ask('', { send: false })} data-drag>
        <I name="ai" />
        <span className="ph">AI에게: 근처 라멘집, 시부야 가는 법…</span>
        <span className="go" aria-hidden="true"><I name="send" /></span>
      </button>
      <div className="quick">
        <button onClick={() => ui().push({ type: 'saved' }, 'half')}><I name="bookmark" />저장한 곳</button>
        <button onClick={() => { ui().setTab('tools'); ui().push({ type: 'phrases' }); }}><I name="big" />회화 카드</button>
        <button onClick={() => { ui().setTab('tools'); ui().push({ type: 'interpreter' }); }}><I name="translate" />통역</button>
        <button onClick={() => { ui().setTab('tools'); ui().push({ type: 'currency' }); }}><I name="yen" />환율</button>
      </div>

      {nextRes && (
        <button className="next-res" onClick={() => { ui().setTab('booking', 'half'); ui().push({ type: 'reservation', id: nextRes.id }); }}>
          <I name="ticket" className="lg" />
          <div className="grow">
            <div className="when">{nextRes.date === today ? '오늘' : nextRes.date.slice(5).replace('-', '/')}{nextRes.time ? ` ${nextRes.time}` : ''}</div>
            <div className="ellipsis">{nextRes.title}{nextRes.people ? ` · ${nextRes.people}명` : ''}</div>
          </div>
          <I name="chevron" />
        </button>
      )}

      {trip && (
        <button className="card soft" style={{ textAlign: 'left' }} onClick={() => { ui().setTab('trip', 'half'); ui().push({ type: 'trip', id: trip.id, day: today }); }}>
          <div className="hstack"><I name="calendar" /><b className="grow ellipsis">{trip.title} · 오늘</b><I name="chevron" /></div>
          <div className="small muted" style={{ marginTop: 4 }}>
            {todayStops.length ? todayStops.slice(0, 4).map(s => `${s.time ? s.time + ' ' : ''}${s.place.name}`).join(' → ') : '오늘 일정이 비어 있어요. 장소를 추가해 보세요.'}
          </div>
        </button>
      )}

      {weather?.current?.temp != null && (
        <button className="mini-weather" onClick={() => { ui().setTab('tools'); ui().push({ type: 'weather' }); }}>
          <I name={weatherIcon(weather.current.code)} className="lg" />
          <span className="t">{Math.round(weather.current.temp)}°</span>
          <span className="grow small muted">
            {weatherText(weather.current.code)}{area?.label ? ` · ${area.label}` : ''}
            {weather.hours.some(h => (h.pop ?? 0) >= 50) ? <><br /><b style={{ color: 'var(--link)' }}>☂ {weather.hours.find(h => (h.pop ?? 0) >= 50)?.time}쯤 비 소식</b></> : null}
          </span>
          <I name="chevron" />
        </button>
      )}

      {rows.length > 0 && (
        <div className="status-list">
          {rows.map((r, i) => (
            <div key={i} className={`st ${r.tone}`}>
              <I name={r.icon} />
              <div className="grow">{r.text}</div>
              {r.action && <button className="btn sm primary" onClick={r.action.run}>{r.action.label}</button>}
            </div>
          ))}
        </div>
      )}
      {provider && <div className="tiny faint">AI: {PROVIDER_LABEL[provider]} · 지도: {engine === 'google' ? 'Google 지도' : engine === 'maplibre' ? '무료 지도 (OpenStreetMap)' : '불러오는 중'}{me ? ` · 위치 정확도 ±${Math.round(me.acc)}m` : ''}</div>}

      <div>
        <h3 className="sec">AI에게 이렇게 물어보세요</h3>
        <div className="suggest">
          {EXAMPLES.map(q => <button key={q} onClick={() => ui().ask(q)}>{q}</button>)}
        </div>
      </div>

      <div>
        <h3 className="sec">빠른 이동</h3>
        <div className="jumps">
          {JUMPS.map(([ko, ja, lat, lng]) => (
            <button key={ko} className="jump" onClick={() => { useGeo.getState().setFollow(false); mapApi.focus({ lat, lng }, 15); ui().setSheet('peek'); }}>
              <b>{ko}</b><span className="ja" lang="ja">{ja}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="tiny faint" style={{ marginTop: 8 }}>
        {fmtHM(new Date(now))} 일본 시각 · 지도 데이터 © Google / OpenStreetMap 기여자 · 날씨 Open-Meteo · 지진 P2P地震情報 · 환율 ECB
      </p>
    </div>
  );
}
