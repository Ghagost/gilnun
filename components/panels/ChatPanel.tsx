'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { effectiveProvider, providerAvailable, sendChat, stopChat } from '@/lib/ai/run';
import { PROVIDER_LABEL } from '@/lib/ai/types';
import { openPlace, startDirections } from '@/lib/actions';
import { fileToImage, type B64Image } from '@/lib/image';
import { listen, speak, speechSupported, stopSpeaking } from '@/lib/speech';
import { useChat } from '@/lib/store/chat';
import { placeByRef, usePlaces } from '@/lib/store/places';
import { useRuntime } from '@/lib/store/runtime';
import { useSettings, settings, MODEL_CHOICES } from '@/lib/store/settings';
import { toast, ui, useUi } from '@/lib/store/ui';
import type { AiProvider, ChatMsg } from '@/lib/types';
import { I } from '../Icons';
import { Markdown, makeInline, stripMd } from '../Markdown';
import { Dots, ProviderLogo } from '../ui';

const EXAMPLES = [
  '근처에 지금 문 연 맛집 3곳 추천해줘',
  '여기서 가장 가까운 편의점 ATM',
  '이 근처 밤에 가볼 만한 곳',
  '나리타공항에서 신주쿠 가는 제일 싼 방법',
  '내일 비 오면 갈 만한 실내 명소로 일정 짜줘',
  '알레르기(새우) 있다고 직원에게 보여줄 문장',
];

function useInline() {
  const idOf = usePlaces(s => s.idOf);
  return useMemo(() => makeInline(r => !!idOf[r], r => { const p = placeByRef(r); if (p) openPlace(p.id); }), [idOf]);
}

function Bubble({ m, last }: { m: ChatMsg; last: boolean }) {
  const inline = useInline();
  const byId = usePlaces(s => s.byId);
  const idOf = usePlaces(s => s.idOf);
  const dest = usePlaces(s => s.dest);
  if (m.role === 'user') {
    return (
      <div className="msg me">
        {m.image && <img src={`data:${m.image.mime};base64,${m.image.b64}`} alt="보낸 사진" />}
        {m.text}
      </div>
    );
  }
  const refs = (m.refs || []).map(r => ({ r, p: byId[idOf[r]] })).filter(x => x.p).slice(0, 12);
  return (
    <div className="msg ai" aria-live={m.pending ? 'polite' : undefined}>
      {m.steps && m.steps.length > 0 && (
        <div className="steps">{m.steps.slice(-6).map((s, i) => <div key={i}><I name={/검색|찾는|확인|계산/.test(s) ? 'search' : 'check'} />{s}</div>)}</div>
      )}
      {m.text && <Markdown text={m.text} inline={inline} />}
      {m.pending && <div className="hstack"><Dots /><button className="btn sm" onClick={stopChat}><I name="stop" />멈추기</button></div>}
      {m.error && (
        <div className="stack" style={{ gap: 6 }}>
          <p className="err" style={{ margin: 0 }}>{m.error}</p>
          {/키|접속 코드|권한/.test(m.error) && <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => { ui().setTab('tools'); ui().push({ type: 'settings', section: 'ai' }); }}><I name="gear" />설정 열기</button>}
        </div>
      )}
      {m.mapsSources && m.mapsSources.length > 0 && (
        <div className="gsources">
          <b>Google 지도 출처</b>
          {m.mapsSources.slice(0, 8).map(s => <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a>)}
        </div>
      )}
      {refs.length > 0 && (
        <div className="pchips">
          {refs.map(({ r, p }) => (
            <button key={r} className="pchip" onClick={() => openPlace(p.id)}>
              <span className="badge" style={{ ['--c' as string]: 'var(--ink)' }}>{r.slice(1)}</span><span>{p.name}</span>
            </button>
          ))}
        </div>
      )}
      {m.sources && m.sources.length > 0 && (
        <div className="sources">출처 {m.sources.slice(0, 5).map(s => <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">{s.title || new URL(s.url).hostname}</a>)}</div>
      )}
      {!m.pending && m.text && (
        <div className="msg-tools">
          <button onClick={async () => { try { await navigator.clipboard.writeText(stripMd(m.text)); toast('복사했어요'); } catch { toast('복사하지 못했어요'); } }}><I name="copy" />복사</button>
          <button onClick={() => void speak(stripMd(m.text))}><I name="sound" />읽기</button>
          {last && dest && <button onClick={() => startDirections(dest)}><I name="route" />경로 보기</button>}
          {last && dest && <button onClick={() => ui().open({ type: 'camera' })}><I name="camera" />카메라 안내</button>}
        </div>
      )}
    </div>
  );
}

function ProviderSwitch({ onClose }: { onClose: () => void }) {
  const provider = useSettings(s => s.provider);
  const models = useSettings(s => s.models);
  useRuntime(s => s.config);
  return (
    <div className="card" style={{ margin: '0 12px 8px', display: 'grid', gap: 8 }}>
      <div className="prov-pick">
        {(['openai', 'anthropic', 'gemini'] as AiProvider[]).map(p => {
          const ok = providerAvailable(p);
          return (
            <button key={p} aria-pressed={provider === p} onClick={() => {
              if (!ok) { ui().setTab('tools'); ui().push({ type: 'settings', section: 'ai' }); onClose(); return; }
              settings().set({ provider: p }); onClose();
            }}>
              <ProviderLogo p={p} />{PROVIDER_LABEL[p]}
              <small>{ok ? (MODEL_CHOICES[p].find(c => c.id === models[p])?.label || models[p]) : '키 필요'}</small>
            </button>
          );
        })}
      </div>
      <p className="hint">모델·키는 도구 → 설정 → AI에서 바꿀 수 있어요.</p>
    </div>
  );
}

export default function ChatPanel() {
  const messages = useChat(s => s.messages);
  const busy = useChat(s => s.busy);
  const draft = useUi(s => s.chatDraft);
  useSettings(s => s.provider);
  useSettings(s => s.keys);
  useRuntime(s => s.config);
  const provider = effectiveProvider();
  const [text, setText] = useState('');
  const [image, setImage] = useState<B64Image | null>(null);
  const [listening, setListening] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef<(() => void) | null>(null);

  // Messages sent from other screens ("AI에게 묻기").
  useEffect(() => {
    if (!draft) return;
    ui().clearDraft();
    if (draft.send && (draft.text || draft.image)) void sendChat(draft.text, draft.image);
    else { setText(draft.text); setTimeout(() => taRef.current?.focus(), 250); }
  }, [draft]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(140, ta.scrollHeight)}px`;
  }, [text]);

  const submit = () => {
    if (busy) return;
    const t = text.trim();
    if (!t && !image) return;
    setText('');
    const img = image;
    setImage(null);
    taRef.current?.blur();
    void sendChat(t, img);
  };

  const mic = async () => {
    if (listening) { stopRef.current?.(); return; }
    if (!speechSupported()) { toast('이 브라우저는 음성 입력을 지원하지 않아요'); return; }
    stopSpeaking();
    setListening(true);
    const h = listen('ko-KR', t => setText(t));
    stopRef.current = h.stop;
    try {
      const t = await h.promise;
      if (t) { setText(''); void sendChat(t, image); setImage(null); }
    } catch (e) {
      toast((e as Error).message === 'not-allowed' ? '마이크 권한을 허용해 주세요' : '음성을 알아듣지 못했어요');
    } finally { setListening(false); stopRef.current = null; }
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    const r = await fileToImage(f);
    if (!r) { toast('이 사진은 읽을 수 없어요'); return; }
    setImage(r.img);
    taRef.current?.focus();
  };

  return (
    <div className="chat-wrap">
      <div className="chat-head" data-drag>
        <h2>AI 길잡이</h2>
        <button className="prov" onClick={() => setShowSwitch(!showSwitch)} aria-expanded={showSwitch} aria-label="AI 바꾸기">
          {provider ? <><ProviderLogo p={provider} />{PROVIDER_LABEL[provider]}</> : <>AI 선택</>}<I name="down" className="sm" />
        </button>
        <button className="icon-btn" onClick={() => ui().open({ type: 'live' })} aria-label="실시간 카메라 대화"><I name="live" /></button>
        {messages.length > 0 && <button className="icon-btn" onClick={() => { if (!busy) useChat.getState().clear(); }} aria-label="대화 지우기"><I name="trash" /></button>}
      </div>
      {showSwitch && <ProviderSwitch onClose={() => setShowSwitch(false)} />}
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 ? (
          <div className="stack" style={{ paddingTop: 6 }}>
            <div className="card soft stack" style={{ gap: 6 }}>
              <b>무엇이든 물어보세요</b>
              <span className="small muted">AI가 실제 지도에서 장소를 찾아 핀을 꽂고, 길·요금·영업시간까지 알려줘요. 사진(메뉴판·표지판)을 보내도 돼요. 답변의 <span className="ref">P3</span> 번호를 누르면 지도에서 열려요.</span>
            </div>
            <div className="suggest">{EXAMPLES.map(q => <button key={q} onClick={() => void sendChat(q)}>{q}</button>)}</div>
            <button className="btn sign block" onClick={() => ui().open({ type: 'live' })}><I name="live" />실시간 카메라로 대화하기</button>
          </div>
        ) : messages.map((m, i) => <Bubble key={m.id} m={m} last={i === messages.length - 1} />)}
      </div>
      <div className="composer">
        {image && (
          <div className="attach">
            <img src={`data:${image.mime};base64,${image.b64}`} alt="첨부할 사진" />
            <span className="grow">사진을 같이 보낼게요</span>
            <button className="btn sm" onClick={() => setImage(null)}>빼기</button>
          </div>
        )}
        <div className="composer-row">
          <button className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="사진 첨부"><I name="photo" /></button>
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            placeholder={listening ? '듣고 있어요…' : provider ? `${PROVIDER_LABEL[provider]}에게 물어보기` : 'AI 키를 넣으면 물어볼 수 있어요'}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            enterKeyHint="send"
            aria-label="AI에게 질문"
          />
          <button className={`icon-btn${listening ? ' listening' : ''}`} onClick={mic} aria-label={listening ? '듣기 멈추기' : '말로 묻기'}><I name="mic" /></button>
          {busy
            ? <button className="icon-btn stop" onClick={stopChat} aria-label="멈추기"><I name="stop" /></button>
            : <button className="icon-btn send" onClick={submit} aria-label="보내기" disabled={!text.trim() && !image}><I name="send" /></button>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
    </div>
  );
}
