'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { currentPanel, useUi, type Snap } from '@/lib/store/ui';
import { useWide } from './hooks';
import PanelHost from './PanelHost';

function tabbarHeight(): number {
  const el = document.querySelector('.tabbar');
  return el ? el.getBoundingClientRect().height : 0;
}
function safeTop(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--safe-t');
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function sheetHeights() {
  const vh = window.innerHeight;
  const H = Math.max(240, vh - tabbarHeight() - safeTop() - 8);
  return { H, peek: Math.min(184, H), half: Math.min(H, Math.round(vh * 0.52)), full: H };
}

export default function Sheet() {
  const sheet = useUi(s => s.sheet);
  const panel = useUi(s => currentPanel(s));
  const tab = useUi(s => s.tab);
  const wide = useWide();
  const [, force] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ y: number; vis: number; t: number; lastY: number; lastT: number; v: number } | null>(null);
  const ref = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const depth = useUi(s => s.stacks[s.tab].length);
  const key = `${tab}:${depth}:${panel.type}:${'id' in panel ? panel.id : ''}`;
  const keyRef = useRef(key);
  const prevDepth = useRef(depth);
  const scrolls = useRef(new Map<string, number>());

  // New panels open at the top; going back (or switching tabs) returns to where you were.
  useLayoutEffect(() => {
    const el = body.current;
    const pushed = depth > prevDepth.current && keyRef.current.split(':')[0] === tab;
    keyRef.current = key;
    prevDepth.current = depth;
    if (!el) return;
    if (pushed) scrolls.current.delete(key);
    el.scrollTop = scrolls.current.get(key) ?? 0;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onResize = () => force(x => x + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const h = typeof window !== 'undefined' ? sheetHeights() : { H: 600, peek: 184, half: 400, full: 600 };
  const visible = wide ? 0 : drag ?? h[sheet];

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--sheet-visible', `${wide ? 0 : Math.round(visible)}px`);
  }, [visible, wide]);

  const onDown = useCallback((e: React.PointerEvent) => {
    if (wide) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, [data-nodrag]')) return;
    start.current = { y: e.clientY, vis: sheetHeights()[useUi.getState().sheet], t: performance.now(), lastY: e.clientY, lastT: performance.now(), v: 0 };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* old browsers */ }
  }, [wide]);

  const onMove = useCallback((e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dy = s.y - e.clientY;
    if (drag == null && Math.abs(dy) < 4) return;
    const hh = sheetHeights();
    const v = Math.max(hh.peek - 40, Math.min(hh.full, s.vis + dy));
    const now = performance.now();
    s.v = (s.lastY - e.clientY) / Math.max(1, now - s.lastT);
    s.lastY = e.clientY; s.lastT = now;
    setDrag(v);
  }, [drag]);

  const onUp = useCallback((e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const hh = sheetHeights();
    const cur = useUi.getState().sheet;
    if (drag == null) {
      // Tap on the grip cycles the snap points.
      if (Math.abs(e.clientY - s.y) < 6 && (e.target as HTMLElement).closest('.grip')) {
        useUi.getState().setSheet(cur === 'peek' ? 'half' : cur === 'half' ? 'full' : 'half');
      }
      return;
    }
    const vis = drag;
    let next: Snap;
    if (s.v > 0.45) next = vis > hh.half ? 'full' : 'half';
    else if (s.v < -0.45) next = vis < hh.half ? 'peek' : 'half';
    else next = (Object.entries({ peek: hh.peek, half: hh.half, full: hh.full }) as [Snap, number][]).sort((a, b) => Math.abs(a[1] - vis) - Math.abs(b[1] - vis))[0][0];
    setDrag(null);
    useUi.getState().setSheet(next);
  }, [drag]);

  const style = wide ? undefined : { transform: `translateY(${Math.max(0, h.H - visible)}px)` };
  const flush = panel.type === 'chat';

  return (
    <section
      ref={ref}
      className={`sheet${drag != null ? ' dragging' : ''}`}
      style={style}
      aria-label="정보 패널"
      data-tab={tab}
      data-snap={sheet}
    >
      <div className="grip" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} role="button" tabIndex={0} aria-label="패널 크기 바꾸기"
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const c = useUi.getState().sheet; useUi.getState().setSheet(c === 'peek' ? 'half' : c === 'half' ? 'full' : 'peek'); } }}>
        <span />
      </div>
      <DragZone bodyRef={body} onScroll={top => scrolls.current.set(keyRef.current, top)} onDown={onDown} onMove={onMove} onUp={onUp} flush={flush}>
        <PanelHost panel={panel} />
      </DragZone>
    </section>
  );
}

function DragZone({ children, onDown, onMove, onUp, flush, bodyRef, onScroll }: { children: ReactNode; flush: boolean; bodyRef: React.RefObject<HTMLDivElement | null>; onScroll: (top: number) => void; onDown: (e: React.PointerEvent) => void; onMove: (e: React.PointerEvent) => void; onUp: (e: React.PointerEvent) => void }) {
  // Dragging works from the panel header (marked data-drag) as well as the grip.
  const handleDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-drag]')) onDown(e);
  };
  return (
    <div ref={bodyRef} className={`sheet-body${flush ? ' flush' : ''}`} onScroll={e => onScroll(e.currentTarget.scrollTop)} onPointerDown={handleDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {children}
    </div>
  );
}
