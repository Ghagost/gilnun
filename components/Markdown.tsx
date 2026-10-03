'use client';

import { Fragment, type ReactNode } from 'react';

type Inline = (text: string, key: string) => ReactNode[];

/** Inline markdown: **bold**, `code`, [label](https://…), and P-refs (P12) when known. */
export function makeInline(isRef: (r: string) => boolean, onRef: (r: string) => void): Inline {
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|\bP\d{1,4}\b)/g;
  return (text, key) => {
    const out: ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const tok = m[0];
      const k = `${key}-${i++}`;
      if (tok.startsWith('**')) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
      else if (tok.startsWith('`')) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
      else if (tok.startsWith('[')) {
        const label = tok.slice(1, tok.indexOf(']('));
        out.push(<a key={k} href={m[2]} target="_blank" rel="noopener noreferrer">{label}</a>);
      } else if (isRef(tok)) out.push(<button key={k} type="button" className="ref" onClick={() => onRef(tok)}>{tok}</button>);
      else out.push(tok);
      last = m.index + tok.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  };
}

/** Block markdown subset: paragraphs, bullet/numbered lists, #### headings. Builds React nodes (no HTML injection). */
export function Markdown({ text, inline }: { text: string; inline: Inline }) {
  const blocks: ReactNode[] = [];
  let list: { kind: 'ul' | 'ol'; start: number; items: string[] } | null = null;
  let para: string[] = [];
  let n = 0;
  const flushPara = () => {
    if (para.length) { const k = `p${n++}`; blocks.push(<p key={k}>{para.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l, `${k}-${i}`)}</Fragment>)}</p>); para = []; }
  };
  const flushList = () => {
    if (!list) return;
    const k = `l${n++}`;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, `${k}-${i}`)}</li>);
    blocks.push(list.kind === 'ul' ? <ul key={k}>{items}</ul> : <ol key={k} start={list.start}>{items}</ol>);
    list = null;
  };
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
      flushPara();
      if (!list || list.kind !== 'ul') { flushList(); list = { kind: 'ul', start: 1, items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    if ((m = /^\s*(\d+)[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      if (!list || list.kind !== 'ol') { flushList(); list = { kind: 'ol', start: Number(m[1]), items: [] }; }
      list.items.push(m[2]);
      continue;
    }
    if ((m = /^#{1,6}\s+(.*)$/.exec(line))) { flushPara(); flushList(); const k = `h${n++}`; blocks.push(<h4 key={k}>{inline(m[1], k)}</h4>); continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (list) flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return <div className="md">{blocks}</div>;
}

export function stripMd(t: string): string {
  return t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*•]\s+/gm, '').replace(/\(P\d+\)/g, '');
}
