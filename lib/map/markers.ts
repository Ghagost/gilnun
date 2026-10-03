import { iconSvg } from '@/components/Icons';
import type { MarkerSpec } from './types';

const PIN_PATH = 'M16 41C14.5 35.5 3 27.5 3 16a13 13 0 0 1 26 0c0 11.5-11.5 19.5-13 25z';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** Builds (or updates) the DOM for a map pin; shared by the Google and MapLibre adapters. */
export function renderMarker(el: HTMLElement, m: MarkerSpec) {
  el.className = `mk${m.selected ? ' sel' : ''}`;
  el.dataset.id = m.id;
  el.title = m.title || '';
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', m.title || m.label || '장소');
  const isDest = m.kind === 'dest';
  const inner = isDest
    ? iconSvg('flag')
    : m.label
      ? `<span>${esc(m.label)}</span>`
      : iconSvg(m.icon || 'pin');
  const caption = m.caption ? `<div class="mk-label">${esc(m.caption)}</div>` : '';
  const html = `<div class="mk-pin${isDest ? ' mk-dest' : ''}" style="--c:${esc(m.color)}"><svg viewBox="0 0 32 42" aria-hidden="true"><path d="${PIN_PATH}"/></svg>${inner}</div>${caption}`;
  if (el.innerHTML !== html) el.innerHTML = html;
}

export function markerKey(m: MarkerSpec): string {
  return `${m.kind}|${m.color}|${m.label || ''}|${m.icon || ''}|${m.caption || ''}|${m.selected ? 1 : 0}|${m.title || ''}`;
}

export function renderUser(el: HTMLElement, heading: number | null, stale?: boolean) {
  if (!el.firstChild) el.innerHTML = '<div class="me-mk"><i class="cone"></i><b class="dot"></b></div>';
  const me = el.firstChild as HTMLElement;
  me.classList.toggle('has-heading', heading != null);
  me.classList.toggle('stale', !!stale);
}
