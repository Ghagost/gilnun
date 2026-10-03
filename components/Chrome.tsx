'use client';

import { useEffect, useMemo, useState } from 'react';
import { isoDate, fmtHM, parseJst } from '@/lib/format';
import { distance, fmtDist, walkMinutes } from '@/lib/geo';
import { mapApi } from '@/lib/map/instance';
import { locateOnce, requestCompass } from '@/lib/sensors';
import { alertQuake } from '@/lib/boot';
import { useGeo, geo } from '@/lib/store/geo';
import { useRuntime, runtime } from '@/lib/store/runtime';
import { useSettings, settings } from '@/lib/store/settings';
import { useTrip } from '@/lib/store/trip';
import { useUi, ui, type Tab } from '@/lib/store/ui';
import { startDirections } from '@/lib/actions';
import { useChat } from '@/lib/store/chat';
import { I } from './Icons';
import { useNow, useWide } from './hooks';

const TABS: { t: Tab; label: string; icon: string }[] = [
  { t: 'map', label: '지도', icon: 'map' },
  { t: 'trip', label: '일정', icon: 'calendar' },
  { t: 'ai', label: 'AI', icon: 'ai' },
  { t: 'booking', label: '예약', icon: 'ticket' },
  { t: 'tools', label: '도구', icon: 'grid' },
];

export function TabBar() {
  const tab = useUi(s => s.tab);
  const busy = useChat(s => s.busy);
  const now = useNow(60000);
  const upcoming = useTrip(s => s.reservations.filter(r => r.status !== 'cancelled' && r.date === isoDate(new Date(now))).length);
  return (
    <nav className="tabbar" aria-label="주요 메뉴">
      {TABS.map(x => (
        <button key={x.t} className={`tab${x.t === 'ai' ? ' ai' : ''}`} aria-current={tab === x.t ? 'page' : undefined} onClick={() => ui().setTab(x.t)}>
          {x.t === 'ai' ? <span className="bubble"><I name={busy ? 'more' : 'ai'} /></span> : <I name={x.icon} />}
          <span>{x.label}</span>
          {x.t === 'booking' && upcoming > 0 && <span className="dot">{upcoming}</span>}
        </button>
      ))}
    </nav>
  );
}

export function Fabs() {
  const tab = useUi(s => s.tab);
  const sheet = useUi(s => s.sheet);
  const layersOpen = useUi(s => s.layersOpen);
  const follow = useGeo(s => s.follow);
  const engine = useRuntime(s => s.engine);
  const transit = useSettings(s => s.transitLayer);
  const traffic = useSettings(s => s.trafficLayer);
  const wide = useWide();
  const [tilt, setTilt] = useState(false);
  const [heading, setHeading] = useState(0);

  useEffect(() => {
    const id = setInterval(() => { const a = mapApi.get(); if (a) { setHeading(a.getHeading()); setTilt(a.isTilted()); } }, 700);
    return () => clearInterval(id);
  }, []);

  if (!wide && (sheet === 'full' || (tab !== 'map' && tab !== 'trip'))) return null;

  const locate = async () => {
    void requestCompass();
    const g = geo();
    if (!g.me) {
      const ok = await locateOnce();
      if (!ok) { ui().showToast(geo().error === 'denied' ? '위치 권한을 허용해 주세요 (주소창 왼쪽 아이콘 → 권한)' : '위치를 찾는 중이에요…'); return; }
    }
    const me = geo().me!;
    geo().setFollow(true);
    mapApi.focus({ lat: me.lat, lng: me.lng }, Math.max(mapApi.get()?.getZoom() ?? 15, 16));
  };

  return (
    <>
      <div className="fabs">
        <button className={`fab${follow ? ' follow' : ''}`} onClick={locate} aria-label="내 위치로" aria-pressed={follow}><I name="locate" /></button>
        <button className={`fab${tilt ? ' on' : ''}`} onClick={() => { mapApi.get()?.setTilt3D(!tilt); setTilt(!tilt); }} aria-label="3D 보기" aria-pressed={tilt}>3D</button>
        <button className={`fab${layersOpen ? ' on' : ''}`} onClick={() => ui().setLayers(!layersOpen)} aria-label="지도 레이어" aria-expanded={layersOpen}><I name="layers" /></button>
        {Math.abs(heading) > 1 && (
          <button className="fab" onClick={() => mapApi.get()?.resetNorth()} aria-label="북쪽을 위로"><I name="compass" style={{ transform: `rotate(${-heading}deg)` }} /></button>
        )}
      </div>
      <button className="fab-cam" onClick={() => ui().open({ type: 'camera' })}><I name="camera" />카메라 길안내</button>
      {layersOpen && (
        <div className="layers" role="dialog" aria-label="지도 레이어">
          {engine === 'google' ? (
            <>
              <button aria-pressed={transit} onClick={() => settings().set({ transitLayer: !transit })}><I name="rail" />전철 노선도</button>
              <button aria-pressed={traffic} onClick={() => settings().set({ trafficLayer: !traffic })}><I name="traffic" />실시간 교통</button>
            </>
          ) : (
            <p className="hint" style={{ padding: '4px 8px' }}>노선도·교통 정보는 구글 지도에서 볼 수 있어요. 설정 → 지도에서 구글 키를 넣어 주세요.</p>
          )}
          <button aria-pressed={tilt} onClick={() => { mapApi.get()?.setTilt3D(!tilt); setTilt(!tilt); }}><I name="cube" />3D 건물</button>
          <button aria-pressed={false} onClick={() => { ui().setLayers(false); ui().setTab('tools'); ui().push({ type: 'settings', section: 'map' }); }}><I name="gear" />지도 설정</button>
        </div>
      )}
    </>
  );
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function Toast() {
  const t = useUi(s => s.toast);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!t) return;
    setShow(true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setShow(false), Math.min(6000, 2200 + t.msg.length * 40));
  }, [t]);
  return <div className={`toast${show ? ' show' : ''}`} role="status" aria-live="polite">{t?.msg}</div>;
}

export function Banners() {
  const quakes = useRuntime(s => s.quakes);
  const dismissedQuake = useRuntime(s => s.dismissedQuake);
  const online = useRuntime(s => s.online);
  const reservations = useTrip(s => s.reservations);
  const me = useGeo(s => s.me);
  const now = useNow(30000);
  const [dismissedRes, setDismissedRes] = useState<string | null>(null);
  const q = useMemo(() => alertQuake(quakes, now), [quakes, now]);

  const soon = useMemo(() => {
    for (const r of reservations) {
      if (r.status === 'cancelled' || !r.time) continue;
      const at = parseJst(r.date, r.time);
      if (!at) continue;
      const mins = (at.getTime() - now) / 60000;
      if (mins > -10 && mins <= 120) return { r, mins: Math.round(mins), at };
    }
    return null;
  }, [reservations, now]);

  // System notification for an upcoming reservation (when allowed and the app is in the background).
  useEffect(() => {
    if (!soon || !settings().notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const key = `gilnun.notified.${soon.r.id}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { return; }
    const body = `${fmtHM(soon.at)} ${soon.r.title}${soon.r.people ? ` · ${soon.r.people}명` : ''}`;
    navigator.serviceWorker?.getRegistration().then(reg => reg?.showNotification('곧 예약 시간이에요', { body, tag: soon.r.id, icon: '/icon-192.png' })).catch(() => { try { new Notification('곧 예약 시간이에요', { body }); } catch { /* ignore */ } });
  }, [soon]);

  const items = [];
  if (!online) items.push(<div key="off" className="banner"><I name="wifioff" /><div className="grow">오프라인이에요. 저장한 일정·예약·회화 카드는 그대로 쓸 수 있어요.</div></div>);
  if (q && q.id !== dismissedQuake) {
    items.push(
      <div key="q" className="banner alert" role="alert">
        <I name="quake" />
        <div className="grow"><b>지진 · 최대 진도 {q.scaleText}</b>{q.place} · {fmtHM(new Date(q.time))}{q.tsunami === 'Warning' || q.tsunami === 'Watch' ? ' · 쓰나미 주의' : ''}</div>
        <button className="btn sm" style={{ background: '#fff', color: '#C2372D', borderColor: '#fff' }} onClick={() => { ui().setTab('tools'); ui().push({ type: 'safety' }); }}>안전 정보</button>
        <button className="x" onClick={() => runtime().set({ dismissedQuake: q.id })} aria-label="닫기"><I name="x" /></button>
      </div>,
    );
  }
  if (soon && soon.r.id !== dismissedRes) {
    const d = soon.r.place && me ? distance(me, soon.r.place) : null;
    items.push(
      <div key="r" className="banner sign">
        <I name="ticket" />
        <div className="grow"><b>{soon.mins > 0 ? `${soon.mins}분 뒤 예약` : '지금 예약 시간'} · {soon.r.time}</b>{soon.r.title}{d != null ? ` · ${fmtDist(d)} (도보 ${walkMinutes(d)}분)` : ''}</div>
        {soon.r.place && <button className="btn sm primary" onClick={() => startDirections(soon.r.place!)}>길찾기</button>}
        <button className="x" style={{ background: 'rgba(0,0,0,.08)' }} onClick={() => setDismissedRes(soon.r.id)} aria-label="닫기"><I name="x" /></button>
      </div>,
    );
  }
  if (!items.length) return null;
  return <div className="banners">{items}</div>;
}
