'use client';

import { useEffect, useState } from 'react';
import { keepAwake } from '@/lib/sensors';
import { speak, stopSpeaking } from '@/lib/speech';
import { toast, ui } from '@/lib/store/ui';
import { I } from '../Icons';

/** Full-screen Japanese text to show staff, taxi drivers or passers-by. */
export default function BigText({ ja, ko, addr, lead }: { ja: string; ko?: string; addr?: string; lead?: string }) {
  const [rot, setRot] = useState(false);
  const leadText = lead ?? (addr ? 'ここに行きたいです' : undefined);
  const len = [...ja].length;
  const size = len > 60 ? 6.2 : len > 36 ? 7.4 : len > 18 ? 8.6 : 10.5;

  useEffect(() => {
    void keepAwake(true);
    return () => { void keepAwake(false); stopSpeaking(); };
  }, []);

  const read = () => void speak([leadText, ja, addr].filter(Boolean).join('。'), 'ja-JP', 0.9);
  const copy = async () => {
    try { await navigator.clipboard.writeText([ja, addr].filter(Boolean).join('\n')); toast('복사했어요'); } catch { toast('복사하지 못했어요'); }
  };

  return (
    <div className={`bigtext${rot ? ' rot' : ''}`} role="dialog" aria-label="직원에게 보여주기">
      <div className="lead" lang="ja">{leadText || ' '}</div>
      <div className="main">
        <div className="bj" lang="ja" style={{ fontSize: `clamp(28px, ${size}vw, 92px)` }}>{ja}</div>
        {addr && <div className="ba" lang="ja" style={{ whiteSpace: 'pre-wrap' }}>{addr}</div>}
        {ko && <div className="bk">{ko}</div>}
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        <div className="row">
          <button className="btn alt" onClick={read}><I name="sound" />읽어주기</button>
          <button className="btn alt" onClick={() => setRot(r => !r)} aria-pressed={rot}><I name="flip" />뒤집기</button>
          <button className="btn alt" onClick={() => void copy()}><I name="copy" />복사</button>
        </div>
        <button className="btn lg block" onClick={() => ui().close('bigtext')}>닫기</button>
      </div>
    </div>
  );
}
