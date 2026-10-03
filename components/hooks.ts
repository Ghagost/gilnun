'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export function useMedia(query: string): boolean {
  const subscribe = (cb: () => void) => {
    const m = window.matchMedia(query);
    m.addEventListener?.('change', cb);
    return () => m.removeEventListener?.('change', cb);
  };
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

export const useWide = () => useMedia('(min-width: 768px)');

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms == null) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function useNow(ms = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), ms);
  return now;
}

/** Object URL for a blob, revoked on change/unmount. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
