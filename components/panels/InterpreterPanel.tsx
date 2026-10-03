'use client';

import { useEffect, useRef, useState } from 'react';
import { effectiveProvider, quickAsk } from '@/lib/ai/run';
import { aiErrorText } from '@/lib/ai/transport';
import { uid } from '@/lib/format';
import { listen, speak, speechSupported, stopSpeaking } from '@/lib/speech';
import { toast, ui } from '@/lib/store/ui';
import { I } from '../Icons';
import { Dots, PanelHead } from '../ui';

type Turn = { id: string; from: 'ko' | 'ja'; src: string; dst: string; pending?: boolean; error?: string };

const PROMPT = {
  ko: (t: string) => `다음 한국어를 일본인과의 대화에서 쓸 자연스럽고 정중한 일본어(です・ます체)로 번역해. 번역문만 출력해.\n\n${t}`,
  ja: (t: string) => `다음 일본어를 자연스러운 한국어로 번역해. 번역문만 출력해.\n\n${t}`,
};

export default function InterpreterPanel() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [listening, setListening] = useState<'ko' | 'ja' | null>(null);
  const [interim, setInterim] = useState('');
  const [typed, setTyped] = useState('');
  const stopRef = useRef<(() => void) | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [turns, interim]);
  useEffect(() => () => { stopRef.current?.(); stopSpeaking(); }, []);

  const translate = async (from: 'ko' | 'ja', text: string) => {
    const id = uid('t');
    setTurns(t => [...t, { id, from, src: text, dst: '', pending: true }]);
    try {
      let out = '';
      await quickAsk(PROMPT[from](text), { maxTokens: 400, onDraft: d => { out = d; setTurns(t => t.map(x => (x.id === id ? { ...x, dst: d } : x))); } }).then(r => { out = r; });
      out = out.trim().replace(/^["「]|["」]$/g, '');
      setTurns(t => t.map(x => (x.id === id ? { ...x, dst: out, pending: false } : x)));
      void speak(out, from === 'ko' ? 'ja-JP' : 'ko-KR', 0.98);
    } catch (e) {
      setTurns(t => t.map(x => (x.id === id ? { ...x, pending: false, error: aiErrorText(e) } : x)));
    }
  };

  const talk = async (from: 'ko' | 'ja') => {
    if (listening) { stopRef.current?.(); return; }
    if (!effectiveProvider()) { toast('AI 키가 있어야 통역할 수 있어요 (설정 → AI)'); return; }
    if (!speechSupported()) { toast('이 브라우저는 음성 인식을 지원하지 않아요. 아래에 입력해 주세요.'); return; }
    stopSpeaking();
    setListening(from);
    setInterim('');
    const h = listen(from === 'ko' ? 'ko-KR' : 'ja-JP', setInterim);
    stopRef.current = h.stop;
    try {
      const t = await h.promise;
      if (t) void translate(from, t);
    } catch (e) {
      toast((e as Error).message === 'not-allowed' ? '마이크 권한을 허용해 주세요' : '음성을 알아듣지 못했어요');
    } finally { setListening(null); setInterim(''); stopRef.current = null; }
  };

  return (
    <div>
      <PanelHead title="통역" />
      <div className="talk">
        <button className={`ko${listening === 'ko' ? ' listening' : ''}`} onClick={() => talk('ko')}><I name="mic" />{listening === 'ko' ? '듣는 중… (누르면 끝)' : '한국어로 말하기'}</button>
        <button className={`jp${listening === 'ja' ? ' listening' : ''}`} onClick={() => talk('ja')}><I name="mic" /><span lang="ja">{listening === 'ja' ? '聞いています…' : '日本語で話す'}</span></button>
      </div>
      {interim && <p className="small muted" style={{ marginTop: 10 }}>“{interim}”</p>}
      <div className="conv" style={{ marginTop: 14 }}>
        {turns.length === 0 && <p className="small muted">버튼을 누르고 말하면 번역해서 소리로 읽어줘요. 상대방은 노란 버튼을 누르고 일본어로 말하면 돼요.</p>}
        {turns.map(t => (
          <div key={t.id} className={`bub${t.from === 'ko' ? ' ja' : ''}`}>
            <div className="src">{t.src}</div>
            {t.error ? <div className="err small">{t.error}</div> : (
              <div className="hstack" style={{ alignItems: 'flex-start' }}>
                <div className={`dst grow${t.from === 'ko' ? ' ja' : ''}`} lang={t.from === 'ko' ? 'ja' : 'ko'}>{t.dst || (t.pending ? <Dots /> : '')}</div>
                {!t.pending && t.dst && (
                  <>
                    <button className="icon-btn" onClick={() => void speak(t.dst, t.from === 'ko' ? 'ja-JP' : 'ko-KR')} aria-label="다시 듣기"><I name="sound" /></button>
                    {t.from === 'ko' && <button className="icon-btn" onClick={() => ui().open({ type: 'bigtext', ja: t.dst, ko: t.src })} aria-label="크게 보기"><I name="big" /></button>}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="hstack" style={{ marginTop: 14 }}>
        <input className="input grow" value={typed} onChange={e => setTyped(e.target.value)} placeholder="입력해서 번역 (한국어 또는 日本語)" aria-label="번역할 문장"
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && typed.trim()) { const t = typed.trim(); setTyped(''); void translate(/[぀-ヿ一-龯]/.test(t) && !/[가-힣]/.test(t) ? 'ja' : 'ko', t); } }} />
        <button className="btn primary" disabled={!typed.trim()} onClick={() => { const t = typed.trim(); setTyped(''); void translate(/[぀-ヿ一-龯]/.test(t) && !/[가-힣]/.test(t) ? 'ja' : 'ko', t); }}>번역</button>
      </div>
    </div>
  );
}
