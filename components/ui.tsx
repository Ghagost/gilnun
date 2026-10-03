'use client';

import type { ReactNode } from 'react';
import { category } from '@/lib/categories';
import { useUi } from '@/lib/store/ui';
import { I } from './Icons';

export function PanelHead({ title, back = true, children, onBack }: { title: ReactNode; back?: boolean; children?: ReactNode; onBack?: () => void }) {
  const pop = useUi(s => s.pop);
  return (
    <div className="panel-head" data-drag>
      {back && (
        <button className="back" onClick={() => (onBack ? onBack() : pop())} aria-label="뒤로">
          <I name="back" />
        </button>
      )}
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function Stars({ rating, count }: { rating?: number; count?: number }) {
  if (rating == null) return null;
  return (
    <span className="stars num" aria-label={`평점 ${rating.toFixed(1)}${count ? `, 리뷰 ${count}개` : ''}`}>
      ★ {rating.toFixed(1)}{count != null && <span className="faint" style={{ fontWeight: 500 }}> ({count.toLocaleString('ko-KR')})</span>}
    </span>
  );
}

export function Price({ level }: { level?: number }) {
  if (level == null) return null;
  if (level === 0) return <span className="pill">무료</span>;
  return <span className="num" aria-label={`가격대 ${level}/4`}>{'¥'.repeat(level)}<span className="faint">{'¥'.repeat(Math.max(0, 4 - level))}</span></span>;
}

export function CatBadge({ cat, label }: { cat: string; label?: string }) {
  const C = category(cat);
  return <span className="badge" style={{ ['--c' as string]: C.color }}>{label ?? C.label}</span>;
}

export function Empty({ icon = 'info', children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="empty">
      <I name={icon} />
      <div>{children}</div>
    </div>
  );
}

export function Dots() {
  return <span className="dots" aria-label="불러오는 중"><i /><i /><i /></span>;
}

export function ExtLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>;
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

export function weatherIcon(code?: number): string {
  if (code == null) return 'cloud';
  if (code === 0 || code === 1) return 'sun';
  if (code === 2 || code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloud';
}

export function weatherText(code?: number): string {
  if (code == null) return '';
  if (code === 0) return '맑음';
  if (code === 1) return '대체로 맑음';
  if (code === 2) return '구름 조금';
  if (code === 3) return '흐림';
  if (code === 45 || code === 48) return '안개';
  if (code >= 51 && code <= 57) return '이슬비';
  if (code >= 61 && code <= 67) return '비';
  if (code >= 71 && code <= 77) return '눈';
  if (code >= 80 && code <= 82) return '소나기';
  if (code === 85 || code === 86) return '눈보라';
  if (code >= 95) return '뇌우';
  return '';
}

export const PROVIDER_COLOR = { openai: '#10A37F', anthropic: '#D97757', gemini: '#4C7DF0' } as const;
export const PROVIDER_SHORT = { openai: 'G', anthropic: 'C', gemini: 'G' } as const;

export function ProviderLogo({ p }: { p: 'openai' | 'anthropic' | 'gemini' }) {
  const label = p === 'openai' ? 'AI' : p === 'anthropic' ? 'C' : '✦';
  return <span className="logo" style={{ background: PROVIDER_COLOR[p] }} aria-hidden="true">{label}</span>;
}
