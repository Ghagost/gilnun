import { distance } from './geo';
import { reverseArea } from './places/osm';
import { geo, useGeo } from './store/geo';

const RAD = Math.PI / 180;
let watchId: number | null = null;
let compassOn = false;
let raf = 0;
let pendingHeading: number | null = null;

export function startGeo() {
  if (typeof window === 'undefined') return;
  if (!window.isSecureContext) { geo().setError('insecure'); return; }
  if (!('geolocation' in navigator)) { geo().setError('unsupported'); return; }
  if (watchId != null) return;
  watchId = navigator.geolocation.watchPosition(
    p => {
      const c = p.coords;
      geo().setMe({ lat: c.latitude, lng: c.longitude, acc: c.accuracy || 0, t: Date.now() });
      void refreshArea();
    },
    e => {
      if (e.code === 1) {
        geo().setError('denied');
        if (watchId != null) navigator.geolocation.clearWatch(watchId);
        watchId = null;
      } else if (!geo().me) geo().setError('unavailable');
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
  );
}

export function restartGeo() {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  geo().setError(null);
  startGeo();
}

/** One-shot high-accuracy fix (used by the locate button). */
export function locateOnce(): Promise<boolean> {
  return new Promise(resolve => {
    if (!('geolocation' in navigator)) return resolve(false);
    navigator.geolocation.getCurrentPosition(
      p => { geo().setMe({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy || 0, t: Date.now() }); resolve(true); },
      e => { if (e.code === 1) geo().setError('denied'); resolve(false); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  });
}

let areaBusy = false;
async function refreshArea(force = false) {
  const { me, area } = geo();
  if (!me || areaBusy) return;
  if (!force && area && distance(area.at, me) < 400 && Date.now() - area.t < 15 * 60000) return;
  areaBusy = true;
  try {
    const a = await reverseArea(me);
    if (a) geo().setArea({ ...a, at: { lat: me.lat, lng: me.lng }, t: Date.now() });
  } finally { areaBusy = false; }
}

function smooth(prev: number | null, next: number): number {
  if (prev == null) return next;
  const d = ((next - prev + 540) % 360) - 180;
  return (prev + d * 0.3 + 360) % 360;
}

function onOrient(e: DeviceOrientationEvent & { webkitCompassHeading?: number }) {
  let h: number | null = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if (typeof e.alpha === 'number' && (e.absolute || e.type === 'deviceorientationabsolute')) {
    const a = e.alpha * RAD, b = (e.beta || 0) * RAD, g = (e.gamma || 0) * RAD;
    const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
    const m13 = cG * sA * sB + cA * sG, m23 = sA * sG - cA * cG * sB, m33 = cB * cG;
    if (Math.abs(m33) < 0.75) h = Math.atan2(-m13, -m23) / RAD; // phone upright: where the back camera points
    else h = 360 - e.alpha + ((screen.orientation && screen.orientation.angle) || 0); // phone flat: where the top points
    h = (h + 360) % 360;
  }
  if (h == null || Number.isNaN(h)) return;
  pendingHeading = smooth(pendingHeading ?? geo().heading, h);
  if (!raf) raf = requestAnimationFrame(() => {
    raf = 0;
    if (pendingHeading != null) useGeo.getState().setHeading(pendingHeading);
  });
}

export function startCompass() {
  if (compassOn || typeof window === 'undefined') return;
  compassOn = true;
  const w: Window = window;
  w.addEventListener('ondeviceorientationabsolute' in w ? 'deviceorientationabsolute' : 'deviceorientation', onOrient as EventListener, true);
}

/** iOS needs a user gesture to allow orientation events. */
export async function requestCompass() {
  try {
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (DOE && typeof DOE.requestPermission === 'function') await DOE.requestPermission();
  } catch { /* declined */ }
  geo().setCompassAsked(true);
  startCompass();
}

/* ---------- screen wake lock (reference-counted: camera, live talk and big text can overlap) ---------- */
type WakeSentinel = { release: () => Promise<void>; addEventListener?: (t: string, f: () => void) => void };
let wake: WakeSentinel | null = null;
let wakeUsers = 0;
let wakeWired = false;

async function acquireWake() {
  const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<WakeSentinel> } };
  if (!nav.wakeLock || wake || document.visibilityState !== 'visible') return;
  try {
    const w = await nav.wakeLock.request('screen');
    if (wakeUsers <= 0) { void w.release().catch(() => {}); return; }
    wake = w;
    w.addEventListener?.('release', () => { if (wake === w) wake = null; });
  } catch { /* not allowed (battery saver, no gesture) */ }
}

export async function keepAwake(on: boolean) {
  if (typeof document === 'undefined') return;
  if (!wakeWired) {
    wakeWired = true;
    // The browser drops the lock when the page is hidden; take it again on return.
    document.addEventListener('visibilitychange', () => { if (wakeUsers > 0 && document.visibilityState === 'visible') void acquireWake(); });
  }
  wakeUsers = Math.max(0, wakeUsers + (on ? 1 : -1));
  if (wakeUsers > 0) await acquireWake();
  else if (wake) {
    const w = wake;
    wake = null;
    await w.release().catch(() => {});
  }
}
