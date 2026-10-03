'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { angDelta, bearing, dirKo, distance, fmtDist, relDirKo, walkMinutes } from '@/lib/geo';
import { frameFromVideo, type B64Image } from '@/lib/image';
import { googleReady } from '@/lib/map/googleLoader';
import { createGoogleMap } from '@/lib/map/google';
import { mapApi } from '@/lib/map/instance';
import { createMapLibre } from '@/lib/map/maplibre';
import type { MapAdapter } from '@/lib/map/types';
import { requestCompass } from '@/lib/sensors';
import { geo, useGeo } from '@/lib/store/geo';
import { places, usePlaces } from '@/lib/store/places';
import { runtime, useRuntime } from '@/lib/store/runtime';
import { settings } from '@/lib/store/settings';
import { I } from '../Icons';

export type CamState = 'starting' | 'on' | 'off' | 'denied' | 'unavailable' | 'insecure';

/** Back camera stream with torch, flip and frame grabs; stops in the background to save battery. */
export function useCamera(active: boolean) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CamState>(active ? 'starting' : 'off');
  const [torch, setTorch] = useState<boolean | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const seq = useRef(0);

  const stop = useCallback(() => {
    seq.current++;
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!window.isSecureContext) { setState('insecure'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setState('unavailable'); return; }
    stop();
    const my = seq.current;
    setState('starting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (my !== seq.current) { s.getTracks().forEach(t => t.stop()); return; }
      stream.current = s;
      const v = video.current;
      if (v) { v.srcObject = s; await v.play().catch(() => {}); }
      const track = s.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() || {}) as { torch?: boolean };
      setTorch(caps.torch ? false : null);
      setState('on');
    } catch (e) {
      if (my !== seq.current) return;
      const n = (e as Error)?.name;
      setState(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : 'unavailable');
    }
  }, [facing, stop]);

  useEffect(() => {
    if (active) void start();
    else { stop(); setState('off'); }
    return stop;
  }, [active, start, stop]);

  useEffect(() => {
    if (!active) return;
    const vis = () => { if (document.visibilityState === 'hidden') stop(); else void start(); };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [active, start, stop]);

  const toggleTorch = useCallback(async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch == null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch { setTorch(null); }
  }, [torch]);

  const grab = useCallback(async (max = 1024, q = 0.72): Promise<B64Image | null> => {
    const v = video.current;
    if (!v || !stream.current || !v.videoWidth) return null;
    return frameFromVideo(v, max, q);
  }, []);

  return { video, state, torch, toggleTorch, facing, flip: () => setFacing(f => (f === 'environment' ? 'user' : 'environment')), grab, retry: start };
}

/** Keeps a rotation continuous (359° → 1° turns 2°, not −358°) so CSS transitions don't spin. */
export function useUnwrapped(angle: number | null): number | null {
  const last = useRef<number | null>(null);
  if (angle == null) { last.current = null; return null; }
  if (last.current == null) last.current = angle;
  else last.current += angDelta(last.current % 360, angle);
  return last.current;
}

/** Big arrow toward the destination relative to where the phone points, plus distance. */
export function DestArrow({ onPick }: { onPick?: () => void }) {
  const me = useGeo(s => s.me);
  const heading = useGeo(s => s.heading);
  const asked = useGeo(s => s.compassAsked);
  const dest = usePlaces(s => s.dest);
  const b = me && dest ? bearing(me, dest) : null;
  const rel = b != null && heading != null ? angDelta(heading, b) : null;
  const rot = useUnwrapped(rel ?? b);
  if (!dest) {
    return (
      <button className="cam-dest" style={{ textAlign: 'left' }} onClick={onPick}>
        <small>목적지 없음</small>
        <b>어디로 갈까요?</b>
        <span>{onPick ? '눌러서 목적지 찾기' : '지도에서 목적지를 정하면 화살표가 나와요'}</span>
      </button>
    );
  }
  const d = me ? distance(me, dest) : null;
  const needCompass = heading == null && !asked && typeof (window.DeviceOrientationEvent as unknown as { requestPermission?: unknown })?.requestPermission === 'function';
  return (
    <>
      <div className={`arrow${rel == null ? ' north' : ''}`} role="img" aria-label={rel != null ? `목적지는 ${relDirKo(rel)}` : b != null ? `목적지는 ${dirKo(b)}쪽` : '방향 모름'}>
        {rot != null ? <I name="dir" style={{ transform: `rotate(${rot}deg)` }} /> : <I name="compass" />}
      </div>
      <div className="cam-dest">
        <small>목적지{d != null && d < 30 && me && me.acc < 35 ? ' · 거의 도착' : ''}</small>
        <b>{dest.name}</b>
        <span>
          {d != null ? `${fmtDist(d)} · 도보 ${walkMinutes(d)}분` : '내 위치를 찾는 중…'}
          {rel != null ? ` · ${relDirKo(rel)}` : b != null ? ` · ${dirKo(b)}쪽` : ''}
          {me && me.acc > 40 ? ` · GPS ±${Math.round(me.acc)}m` : ''}
        </span>
        {needCompass && <button className="btn sm" style={{ justifySelf: 'start', marginTop: 4 }} onClick={() => void requestCompass()}><I name="compass" />방향 센서 켜기</button>}
      </div>
    </>
  );
}

/** Small heading-up map that follows the user (non-interactive). */
export function Minimap() {
  const el = useRef<HTMLDivElement>(null);
  const [a, setA] = useState<MapAdapter | null>(null);
  const engine = useRuntime(s => s.engine);
  const heading = useGeo(s => s.heading);

  useEffect(() => {
    const box = el.current;
    if (!box || !engine) return;
    let alive = true;
    let adapter: MapAdapter | null = null;
    const center = geo().me || mapApi.center() || { lat: 35.6812, lng: 139.7671 };
    (async () => {
      try {
        if (engine === 'google' && googleReady()) adapter = createGoogleMap(box, { center, zoom: 17, mapId: runtime().config?.google.mapId, scheme: settings().theme, interactive: false });
        else adapter = await createMapLibre(box, { center, zoom: 16.5, dark: false, lang: settings().mapLang, interactive: false });
      } catch { return; }
      if (!alive) { adapter.destroy(); return; }
      setA(adapter);
    })();
    return () => { alive = false; adapter?.destroy(); setA(null); };
  }, [engine]);

  useEffect(() => {
    if (!a) return;
    let last = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      last = Date.now();
      const g = geo();
      const d = places().dest;
      if (g.me) {
        a.setUser({ lat: g.me.lat, lng: g.me.lng, acc: g.me.acc, heading: g.heading, stale: false });
        a.setCamera({ center: g.me, heading: g.heading ?? 0 });
      }
      a.setMarkers(d ? [{ id: 'mini-dest', lat: d.lat, lng: d.lng, kind: 'dest', color: '#FFD21F', title: d.name }] : []);
      a.setRoutes(places().routes);
    };
    const soon = () => {
      clearTimeout(t);
      const wait = 250 - (Date.now() - last);
      if (wait <= 0) sync(); else t = setTimeout(sync, wait);
    };
    sync();
    const unG = useGeo.subscribe(soon);
    const unP = usePlaces.subscribe((s, p) => { if (s.dest !== p.dest || s.routes !== p.routes) soon(); });
    return () => { unG(); unP(); clearTimeout(t); };
  }, [a]);

  return (
    <div className="minimap" aria-hidden="true">
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
      <span className="n" style={heading != null ? { transform: `rotate(${-heading}deg)` } : undefined}>N</span>
    </div>
  );
}
