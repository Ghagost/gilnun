'use client';

import { useState } from 'react';
import { quickAsk, effectiveProvider } from '@/lib/ai/run';
import { aiErrorText } from '@/lib/ai/transport';
import { PHRASES } from '@/lib/phrases';
import { speak } from '@/lib/speech';
import { toast, ui } from '@/lib/store/ui';
import { I } from '../Icons';
import { Dots, PanelHead } from '../ui';

export default function PhrasesPanel() {
  const [group, setGroup] = useState(PHRASES[0].id);
  const [mine, setMine] = useState('');
  const [busy, setBusy] = useState(false);
  const g = PHRASES.find(x => x.id === group) || PHRASES[0];

  const translate = async () => {
    const t = mine.trim();
    if (!t) return;
    if (!effectiveProvider()) { toast('AI 키가 있어야 번역할 수 있어요 (설정 → AI)'); return; }
    setBusy(true);
    try {
      const ja = (await quickAsk(`다음 한국어를 일본 가게 직원에게 보여줄 자연스럽고 정중한 일본어(です・ます체) 한 문장으로 번역해. 번역문만 출력해.\n\n${t}`, { maxTokens: 300 })).trim().replace(/^["「]|["」]$/g, '');
      ui().open({ type: 'bigtext', ja, ko: t });
      void speak(ja, 'ja-JP', 0.95);
    } catch (e) { toast(aiErrorText(e)); } finally { setBusy(false); }
  };

  return (
    <div>
      <PanelHead title="회화 카드" />
      <div className="field" style={{ marginBottom: 10 }}>
        <div className="hstack">
          <input className="input grow" value={mine} onChange={e => setMine(e.target.value)} placeholder="내 문장 번역: 예) 창가 자리로 주세요" onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void translate(); }} aria-label="번역할 문장" />
          <button className="btn primary" onClick={translate} disabled={busy || !mine.trim()}>{busy ? <Dots /> : '번역'}</button>
        </div>
      </div>
      <div className="filters" data-nodrag>
        {PHRASES.map(p => <button key={p.id} className="chip flat" aria-pressed={group === p.id} onClick={() => setGroup(p.id)}><I name={p.icon} />{p.title}</button>)}
      </div>
      <div>
        {g.items.map(p => (
          <div key={p.ja} className="phrase" style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
            <button style={{ textAlign: 'left', display: 'grid', gap: 2 }} onClick={() => { ui().open({ type: 'bigtext', ja: p.ja, ko: p.ko }); void speak(p.ja, 'ja-JP', 0.95); }}>
              <span className="ja" lang="ja">{p.ja}</span>
              <span className="rd">{p.rd}</span>
              <span className="ko">{p.ko}</span>
            </button>
            <button className="icon-btn" onClick={() => void speak(p.ja, 'ja-JP', 0.9)} aria-label="일본어로 듣기"><I name="sound" /></button>
          </div>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 10 }}>문장을 누르면 화면에 크게 띄우고 일본어로 읽어줘요. 상대에게 화면을 보여주세요.</p>
    </div>
  );
}
