'use client';

import { useState } from 'react';
import { ui } from '@/lib/store/ui';
import { I } from '../Icons';

export default function PhotoViewer({ src, caption }: { src: string; caption?: string }) {
  const [zoom, setZoom] = useState(false);
  const close = () => ui().close('photo');
  return (
    <div className={`viewer${zoom ? ' zoomed' : ''}`} role="dialog" aria-label="사진 크게 보기" onClick={close}>
      <img src={src} alt={caption || '사진'} referrerPolicy="no-referrer" onClick={e => { e.stopPropagation(); setZoom(z => !z); }} />
      {caption && <div className="cap">{caption}</div>}
      <button className="cam-btn close" onClick={close} aria-label="닫기"><I name="x" /></button>
    </div>
  );
}
