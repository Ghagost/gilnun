'use client';

import { useEffect, useRef, useState } from 'react';
import { liveGreeting, liveInstructions } from '@/lib/ai/prompts';
import { providerAvailable } from '@/lib/ai/run';
import { frameFromVideo } from '@/lib/image';
import { createLive, LIVE_LABEL, LIVE_NOTE, type LiveClient, type LiveState } from '@/lib/live';
import { liveTools } from '@/lib/live/tools';
import { keepAwake } from '@/lib/sensors';
import { runtime, useRuntime } from '@/lib/store/runtime';
import { LIVE_MODELS, settings, useSettings } from '@/lib/store/settings';
import { ui } from '@/lib/store/ui';
import type { AiProvider, Source } from '@/lib/types';
import { I } from '../Icons';
import { useInterval } from '../hooks';
import { Dots, ProviderLogo } from '../ui';
import { DestArrow, Minimap, useCamera } from './camera';

export type Line = { id: number; who: 'user' | 'ai' | 'step'; text: string; final: boolean };
let lineSeq = 0;

/** Updates the open line of a speaker (or starts a new one); empty finished lines disappear. */
export function upsertLine(lines: Line[], who: 'user' | 'ai', text: string, final: boolean): Line[] {
  const t = text.trim();
  const empty = !t || t === '…';
  let idx = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].who === who && !lines[i].final) { idx = i; break; }
  if (idx >= 0) {
    if (final && empty) return lines.filter((_, i) => i !== idx);
    const next = [...lines];
    next[idx] = { ...next[idx], text: t || '…', final };
    return next;
  }
  if (!t || (final && empty)) return lines;
  return [...lines, { id: ++lineSeq, who, text: t, final }].slice(-40);
}

const ORDER: AiProvider[] = ['gemini', 'openai', 'anthropic'];

function defaultProvider(): AiProvider | null {
  const p = settings().provider;
  if (providerAvailable(p)) return p;
  return ORDER.find(providerAvailable) || null;
}

function mmss(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function LiveSession() {
  const config = useRuntime(s => s.config);
  const keys = useSettings(s => s.keys);
  const dataSaver = useSettings(s => s.dataSaver);
  const [provider, setProvider] = useState<AiProvider | null>(defaultProvider);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<LiveState>('connecting');
  const [detail, setDetail] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [muted, setMuted] = useState(false);
  const [camOn, setCamOn] = useState(true);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [, setTick] = useState(0);
  const cam = useCamera(camOn);
  const camOnRef = useRef(camOn);
  camOnRef.current = camOn;
  const client = useRef<LiveClient | null>(null);
  const capRef = useRef<HTMLDivElement>(null);
  const activity = useRef(Date.now());
  const hiddenAt = useRef<number | null>(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    void keepAwake(true);
    return () => { void keepAwake(false); };
  }, []);

  // Opened before the server config (or a key) arrived: pick a provider as soon as one is usable.
  useEffect(() => {
    if (!provider) { const p = defaultProvider(); if (p) setProvider(p); }
  }, [config, keys]); // eslint-disable-line react-hooks/exhaustive-deps

  // One live session per provider choice (and per "다시 시작").
  useEffect(() => {
    if (!provider) return;
    let alive = true;
    setLines([]); setSources([]); setState('connecting'); setDetail(''); setMuted(false);
    activity.current = Date.now();
    startedAt.current = Date.now();
    const cfg = runtime().config;
    const s = settings();
    const c = createLive(provider, {
      model: provider === 'gemini' ? cfg?.models.geminiLive || LIVE_MODELS.gemini : provider === 'openai' ? cfg?.models.openaiLive || LIVE_MODELS.openai : undefined,
      voice: provider === 'openai' ? s.openaiVoice : s.geminiVoice,
      instructions: liveInstructions(provider === 'anthropic' ? 'turn' : 'voice'),
      tools: liveTools(),
      greeting: liveGreeting(),
      frame: async () => {
        const v = cam.video.current;
        if (!v || !camOnRef.current) return null;
        const f = await frameFromVideo(v, 768, 0.6);
        return f?.b64 ?? null;
      },
      saver: s.dataSaver,
    }, {
      onState: (st, d) => { if (!alive) return; setState(st); setDetail(d || ''); },
      onCaption: (who, t, final) => {
        if (!alive) return;
        if (who === 'user') activity.current = Date.now();
        setLines(ls => upsertLine(ls, who, t, final));
      },
      onStep: t => { if (alive) setLines(ls => [...ls, { id: ++lineSeq, who: 'step' as const, text: t, final: true }].slice(-40)); },
      onSources: src => {
        if (!alive) return;
        setSources(prev => {
          const seen = new Set(prev.map(x => x.url));
          return [...prev, ...src.filter(x => x.url && !seen.has(x.url) && seen.add(x.url))].slice(-8);
        });
      },
    });
    client.current = c;
    c.start().catch(e => {
      if (!alive) return;
      setState('error');
      setDetail((e as Error)?.message || String(e));
    });
    return () => {
      alive = false;
      c.stop();
      if (client.current === c) client.current = null;
    };
  }, [provider, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = capRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, sources]);

  const live = state === 'live' || state === 'reconnecting';
  useInterval(() => setTick(t => t + 1), live ? 200 : null);

  const end = (msg: string) => {
    client.current?.stop();
    setState('ended');
    setDetail(msg);
  };
  // Don't leave a paid session running in a pocket or in the background.
  useInterval(() => {
    const now = Date.now();
    if (document.visibilityState === 'hidden') {
      hiddenAt.current ??= now;
      if (now - hiddenAt.current > 60_000) end('앱을 벗어나 있어서 실시간 대화를 끝냈어요.');
    } else hiddenAt.current = null;
    if (now - activity.current > 5 * 60_000) end('5분 동안 대화가 없어서 끝냈어요. 다시 시작할 수 있어요.');
  }, live ? 5000 : null);

  const close = () => ui().close('live');
  const openSettings = () => { close(); ui().setTab('tools'); ui().push({ type: 'settings', section: 'ai' }); };
  const touch = () => { activity.current = Date.now(); client.current?.resumeAudio?.(); };

  if (!provider) {
    return (
      <div className="cam" role="dialog" aria-label="실시간 카메라 대화">
        <div className="cam-top"><button className="cam-btn" onClick={close} aria-label="닫기"><I name="x" /></button><div className="cam-dest"><b>실시간 카메라 대화</b></div></div>
        <div className="cam-mid">
          <div className="cam-msg">
            <b>AI 키가 필요해요</b>
            <span className="small" style={{ opacity: .85 }}>Gemini(무료 티어 있음)나 ChatGPT 키를 넣으면 카메라를 보여주며 말로 길을 물어볼 수 있어요. Claude 키로는 버튼을 눌러 말하는 방식으로 써요.</span>
            <div className="hstack" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn sm sign" onClick={openSettings}><I name="gear" />AI 설정</button>
              <button className="btn sm" onClick={() => { close(); ui().open({ type: 'camera' }); }}><I name="camera" />카메라 길안내</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const c = client.current;
  const turn = provider === 'anthropic';
  const speaking = live && !!c?.speaking();
  const listening = live && !!c?.listening?.();
  const thinking = live && !!c?.busy?.();
  const level = live && c && !muted ? c.level() : 0;
  const others = ORDER.filter(p => p !== provider && providerAvailable(p));
  const stateText = state === 'connecting' ? '연결 중' : state === 'reconnecting' ? '다시 연결 중' : state === 'error' ? '오류' : state === 'ended' ? '끝남'
    : turn ? (listening ? '듣는 중' : thinking ? '생각 중' : speaking ? '말하는 중' : '버튼을 눌러 말하세요')
      : speaking ? 'AI가 말하는 중' : muted ? '마이크 꺼짐' : '듣고 있어요';

  const mainBtn = () => {
    touch();
    if (!c || !live) return;
    if (turn) {
      if (listening) c.talk?.();
      else if (thinking || speaking) c.interrupt();
      else c.talk?.();
      return;
    }
    if (speaking) c.interrupt();
    else c.lookNow();
  };
  const mainLabel = turn
    ? (listening ? '듣는 중… 끝나면 누르기' : thinking ? '생각 중… (누르면 취소)' : speaking ? '그만 읽기' : '눌러서 말하기')
    : speaking ? '말 끊기' : '이쪽 맞아? 화면 보고 안내';
  const mainIcon = turn ? (listening ? 'stop' : thinking || speaking ? 'stop' : 'mic') : speaking ? 'stop' : 'eye';

  return (
    <div className="cam" role="dialog" aria-label="실시간 카메라 대화" onPointerDown={touch}>
      <video ref={cam.video} playsInline muted autoPlay aria-hidden="true" style={{ opacity: camOn ? 1 : 0 }} />
      <div className="cam-top">
        <button className="cam-btn" onClick={close} aria-label="끝내기"><I name="x" /></button>
        <DestArrow />
        {cam.torch != null && camOn && <button className="cam-btn tog" aria-pressed={cam.torch} onClick={() => void cam.toggleTorch()} aria-label="손전등"><I name="flash" /></button>}
      </div>
      <div className="cam-mid">
        <div style={{ position: 'absolute', right: 12, top: 0, display: 'grid', gap: 6, justifyItems: 'end', zIndex: 3 }}>
          <span className={`live-state${state === 'connecting' || state === 'reconnecting' ? ' connecting' : state === 'error' || state === 'ended' ? ' error' : ''}`}><i />{stateText}</span>
          <span className="live-state"><ProviderLogo p={provider} />{LIVE_LABEL[provider]}</span>
        </div>
        {state === 'connecting' && (
          <div className="cam-msg">
            <Dots />
            <b>{LIVE_LABEL[provider]} 연결 중…</b>
            <span className="small" style={{ opacity: .85 }}>{LIVE_NOTE[provider]} 마이크 권한을 물으면 허용해 주세요.</span>
          </div>
        )}
        {(state === 'error' || state === 'ended') && (
          <div className="cam-msg">
            <b>{state === 'error' ? '실시간 대화를 이어가지 못했어요' : '실시간 대화가 끝났어요'}</b>
            {detail && <span className="small" style={{ opacity: .85 }}>{detail}</span>}
            <div className="hstack" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn sm sign" onClick={() => setNonce(n => n + 1)}><I name="refresh" />다시 시작</button>
              {state === 'error' && /키|코드|인증|권한/.test(detail) && <button className="btn sm" onClick={openSettings}><I name="gear" />설정</button>}
              {state === 'error' && others.map(p => <button key={p} className="btn sm" onClick={() => setProvider(p)}><ProviderLogo p={p} />{LIVE_LABEL[p]}로</button>)}
              <button className="btn sm" onClick={close}>닫기</button>
            </div>
          </div>
        )}
        {state === 'live' && !camOn && <div className="cam-msg"><b>카메라 꺼짐</b><span className="small" style={{ opacity: .85 }}>목소리로만 대화해요. 오른쪽 아래 버튼으로 다시 켤 수 있어요.</span></div>}
        {camOn && (cam.state === 'denied' || cam.state === 'unavailable') && state === 'live' && (
          <div className="cam-msg"><b>{cam.state === 'denied' ? '카메라 권한이 꺼져 있어요' : '카메라를 켤 수 없어요'}</b><span className="small" style={{ opacity: .85 }}>목소리로는 계속 대화할 수 있어요.</span>{cam.state === 'denied' && <button className="btn sm" style={{ justifySelf: 'center' }} onClick={() => void cam.retry()}><I name="refresh" />다시 시도</button>}</div>
        )}
        {!dataSaver && <Minimap />}
      </div>
      <div className="cam-bottom">
        {(lines.length > 0 || sources.length > 0) && (
          <div className="captions" ref={capRef} aria-live="polite">
            {lines.slice(-14).map(l => (l.who === 'step'
              ? <div key={l.id} style={{ fontSize: 12.5, opacity: .7 }}>· {l.text}</div>
              : <div key={l.id} className={l.who === 'user' ? 'u' : 'a'}>{l.text}</div>))}
            {sources.length > 0 && (
              <div style={{ fontSize: 12, opacity: .85 }}>
                Google 지도 출처: {sources.map(s => <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline', marginRight: 8 }}>{s.title || '링크'}</a>)}
              </div>
            )}
          </div>
        )}
        {typing && (
          <form className="hstack" onSubmit={e => { e.preventDefault(); const t = text.trim(); if (t && live) { client.current?.sendText(t); setText(''); activity.current = Date.now(); } }}>
            <input value={text} onChange={e => setText(e.target.value)} placeholder="글자로 묻기 (예: 화장실 어디야?)" autoFocus enterKeyHint="send" aria-label="글자로 묻기"
              style={{ flex: 1, minWidth: 0, height: 46, borderRadius: 14, border: 0, padding: '0 12px', fontSize: 16, background: '#fff', color: '#111' }} />
            <button className="btn sign" type="submit" aria-label="보내기" disabled={!live}><I name="send" /></button>
          </form>
        )}
        <div className="cam-ctrls">
          {turn
            ? <button className="round" aria-pressed={muted} onClick={() => { const m = !muted; setMuted(m); c?.setMuted(m); }} aria-label={muted ? '소리 내어 읽기 켜기' : '소리 내어 읽기 끄기'}><I name={muted ? 'x' : 'sound'} /></button>
            : <button className="round" aria-pressed={muted} onClick={() => { const m = !muted; setMuted(m); c?.setMuted(m); }} aria-label={muted ? '마이크 켜기' : '마이크 끄기'}
                style={level > 0.04 ? { boxShadow: `0 0 0 ${Math.round(Math.min(12, level * 30))}px rgba(255,210,31,.35)` } : undefined}><I name={muted ? 'micoff' : 'mic'} /></button>}
          <button className={`cam-go${listening ? ' listening' : ''}`} onClick={mainBtn} disabled={!live}>
            {state === 'connecting' ? <Dots /> : <><I name={mainIcon} />{mainLabel}</>}
          </button>
          <button className="round" aria-pressed={!camOn} onClick={() => setCamOn(v => !v)} aria-label={camOn ? '카메라 끄기' : '카메라 켜기'}><I name={camOn ? 'camera' : 'eye'} /></button>
        </div>
        <div className="cam-status">
          {live ? `${mmss(Date.now() - startedAt.current)} · ` : ''}
          {turn ? '버튼을 누르고 말한 뒤, 다 말하면 한 번 더 눌러요' : muted ? '마이크가 꺼져 있어요' : '그냥 말하면 돼요 · 이어폰을 쓰면 더 잘 알아들어요'}
        </div>
        <div className="hstack" style={{ justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn sm ghost" style={{ color: '#fff' }} onClick={() => setTyping(t => !t)} aria-pressed={typing}><I name="edit" />글자로</button>
          {turn && <button className="btn sm ghost" style={{ color: '#fff' }} onClick={() => c?.lookNow()} disabled={!live}><I name="eye" />화면 보고 안내</button>}
          {others.map(p => <button key={p} className="btn sm ghost" style={{ color: '#fff' }} onClick={() => setProvider(p)}><ProviderLogo p={p} />{LIVE_LABEL[p]}</button>)}
        </div>
      </div>
    </div>
  );
}
