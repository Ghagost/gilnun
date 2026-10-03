'use client';

import { useEffect, useRef, useState } from 'react';
import { cameraPrompt } from '@/lib/ai/prompts';
import { effectiveProvider, quickAsk } from '@/lib/ai/run';
import { aiErrorText } from '@/lib/ai/transport';
import { PROVIDER_LABEL } from '@/lib/ai/types';
import { angDiff, distance } from '@/lib/geo';
import { fileToImage, parseLooseJson, sceneDiff, sceneSignature, type B64Image } from '@/lib/image';
import { keepAwake } from '@/lib/sensors';
import { listen, speak, speechSupported, stopSpeaking } from '@/lib/speech';
import { geo, useGeo } from '@/lib/store/geo';
import { usePlaces } from '@/lib/store/places';
import { useSettings, settings } from '@/lib/store/settings';
import { toast, ui } from '@/lib/store/ui';
import { I } from '../Icons';
import { useInterval } from '../hooks';
import { Dots } from '../ui';
import { DestArrow, Minimap, useCamera } from './camera';

type Guide = { say: string; steps?: string[]; signs?: { ja: string; ko: string }[]; confidence?: 'high' | 'medium' | 'low'; need?: string };

const CONF: Record<string, string> = { high: '확실해요', medium: '아마 맞아요', low: '확실하지 않아요' };
const AUTO_LIMIT = 40;

function normalize(j: Record<string, unknown> | null, raw: string): Guide {
  if (!j || typeof j.say !== 'string') return { say: raw.replace(/```[\s\S]*?```/g, '').trim().slice(0, 400) || '안내를 만들지 못했어요. 다시 눌러 주세요.', confidence: 'low' };
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    say: j.say.slice(0, 400),
    steps: arr(j.steps).filter((s): s is string => typeof s === 'string').slice(0, 4),
    signs: arr(j.signs).filter((s): s is { ja: string; ko: string } => !!s && typeof (s as { ja?: unknown }).ja === 'string').slice(0, 6).map(s => ({ ja: s.ja.slice(0, 40), ko: String(s.ko || '').slice(0, 40) })),
    confidence: j.confidence === 'high' || j.confidence === 'medium' || j.confidence === 'low' ? j.confidence : undefined,
    need: typeof j.need === 'string' ? j.need.slice(0, 140) : undefined,
  };
}

export default function CameraGuide() {
  const cam = useCamera(true);
  const dest = usePlaces(s => s.dest);
  const me = useGeo(s => s.me);
  const voice = useSettings(s => s.voice);
  const autoSec = useSettings(s => s.autoSec);
  const dataSaver = useSettings(s => s.dataSaver);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [listening, setListening] = useState(false);
  const [photo, setPhoto] = useState<{ img: B64Image; url: string } | null>(null);
  const [lastAt, setLastAt] = useState(0);
  const [, force] = useState(0);
  const busyRef = useRef(false);
  const ctl = useRef<AbortController | null>(null);
  const lastSay = useRef('');
  const lastSig = useRef<Uint8Array | null>(null);
  const lastPos = useRef<{ lat: number; lng: number } | null>(null);
  const lastHeading = useRef<number | null>(null);
  const autoCount = useRef(0);
  const sigCanvas = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const arrived = useRef(false);
  const provider = effectiveProvider();
  const camState = useRef(cam.state);
  camState.current = cam.state;

  useEffect(() => {
    void keepAwake(true);
    return () => { void keepAwake(false); ctl.current?.abort(); stopSpeaking(); };
  }, []);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  useInterval(() => force(n => n + 1), 5000);

  // Arrival: say it once when GPS is good enough.
  useEffect(() => {
    if (!dest || !me || arrived.current) return;
    if (distance(me, dest) < 25 && me.acc < 30) {
      arrived.current = true;
      setGuide({ say: `${dest.name} 근처에 도착했어요. 입구나 간판을 비춰 보면 정확히 알려 드릴게요.`, confidence: 'medium' });
      if (settings().voice) void speak('목적지 근처에 도착했어요.');
      setAuto(false);
    }
  }, [me, dest]);
  useEffect(() => { arrived.current = false; }, [dest?.id]);

  const ask = async (question: string | null, mode: 'manual' | 'auto' | 'voice', img?: B64Image) => {
    if (busyRef.current) return;
    if (!provider) { setError('AI 키가 있어야 화면을 보고 안내할 수 있어요. 설정 → AI에서 키를 넣어 주세요. (화살표와 거리 안내는 지금도 돼요)'); return; }
    busyRef.current = true;
    setBusy(true);
    setError('');
    let frame = img || photo?.img || (await cam.grab(1024, 0.72));
    // Tapped while the camera is still starting: wait a moment for the first frame.
    for (let i = 0; !frame && i < 20 && (camState.current === 'starting' || camState.current === 'on'); i++) {
      await new Promise(r => setTimeout(r, 150));
      frame = await cam.grab(1024, 0.72);
    }
    if (!frame) {
      busyRef.current = false;
      setBusy(false);
      setError(camState.current === 'on' || camState.current === 'starting' ? '카메라 화면을 가져오지 못했어요. 잠시 후 다시 눌러 주세요.' : '카메라가 꺼져 있어요. 아래 ‘사진으로 묻기’를 써 주세요.');
      return;
    }
    ctl.current?.abort();
    const my = new AbortController();
    ctl.current = my;
    try {
      const raw = await quickAsk(cameraPrompt(question, lastSay.current), { images: [frame], json: true, fast: mode === 'auto', signal: my.signal, maxTokens: 700 });
      if (my.signal.aborted) return;
      const g = normalize(parseLooseJson(raw), raw);
      setGuide(g);
      setLastAt(Date.now());
      lastSay.current = g.say;
      if (settings().voice) void speak(g.say);
      const v = cam.video.current;
      if (v) { sigCanvas.current ||= document.createElement('canvas'); lastSig.current = sceneSignature(v, sigCanvas.current); }
      lastPos.current = geo().me ? { lat: geo().me!.lat, lng: geo().me!.lng } : null;
      lastHeading.current = geo().heading;
    } catch (e) {
      if (!my.signal.aborted) {
        setError(aiErrorText(e));
        if (mode === 'auto') setAuto(false);
      }
    } finally {
      if (ctl.current === my) ctl.current = null;
      busyRef.current = false;
      setBusy(false);
    }
  };

  // Auto mode: ask again when the user moved, turned or the scene changed — never more often than the setting.
  useInterval(() => {
    if (!auto || busyRef.current || document.visibilityState !== 'visible' || cam.state !== 'on') return;
    if (Date.now() - lastAt < autoSec * 1000) return;
    const v = cam.video.current;
    if (!v) return;
    sigCanvas.current ||= document.createElement('canvas');
    const sig = sceneSignature(v, sigCanvas.current);
    const g = geo();
    const moved = g.me && lastPos.current ? distance(g.me, lastPos.current) > 6 : true;
    const turned = g.heading != null && lastHeading.current != null ? angDiff(g.heading, lastHeading.current) > 20 : false;
    const changed = sceneDiff(sig, lastSig.current) > 18;
    if (!lastSig.current || moved || turned || changed) {
      if (++autoCount.current > AUTO_LIMIT) { setAuto(false); toast('자동 안내를 잠시 멈췄어요. 필요하면 다시 켜 주세요.'); return; }
      void ask(null, 'auto');
    }
  }, auto ? 1000 : null);

  const toggleAuto = () => {
    if (!auto) {
      if (!provider) { setError('자동 안내는 AI 키가 있어야 해요.'); return; }
      autoCount.current = 0;
      setAuto(true);
      toast(`자동 안내: 움직이거나 방향을 바꾸면 ${autoSec}초마다 알려줘요`);
      if (!busyRef.current) void ask(null, 'auto');
    } else setAuto(false);
  };

  const askVoice = async () => {
    if (listening) return;
    if (!speechSupported()) { toast('이 브라우저는 음성 인식을 지원하지 않아요'); return; }
    stopSpeaking();
    setListening(true);
    try {
      const t = await listen('ko-KR').promise;
      if (t) void ask(t, 'voice');
    } catch (e) {
      toast((e as Error).message === 'not-allowed' ? '마이크 권한을 허용해 주세요' : '음성을 알아듣지 못했어요');
    } finally { setListening(false); }
  };

  const pickPhoto = async (f: File | undefined) => {
    if (!f) return;
    const r = await fileToImage(f, 1280, 0.8);
    if (!r) { toast('이 사진은 읽을 수 없어요'); return; }
    setPhoto({ img: r.img, url: URL.createObjectURL(r.blob) });
    setAuto(false);
    void ask(null, 'manual', r.img);
  };

  const close = () => ui().close('camera');
  const pickDest = () => { close(); ui().open({ type: 'search' }); };
  const camOff = cam.state === 'denied' || cam.state === 'unavailable' || cam.state === 'insecure';
  const since = lastAt ? Math.round((Date.now() - lastAt) / 1000) : null;

  return (
    <div className="cam" role="dialog" aria-label="카메라 길안내">
      <video ref={cam.video} playsInline muted autoPlay aria-hidden="true" />
      {photo && <img className="still" src={photo.url} alt="보낸 사진" />}
      <div className="cam-top">
        <button className="cam-btn" onClick={close} aria-label="닫기"><I name="x" /></button>
        <DestArrow onPick={pickDest} />
        {cam.torch != null && <button className="cam-btn tog" aria-pressed={cam.torch} onClick={() => void cam.toggleTorch()} aria-label="손전등"><I name="flash" /></button>}
      </div>
      <div className="cam-mid">
        {camOff && !photo && (
          <div className="cam-msg">
            <b>{cam.state === 'denied' ? '카메라 권한이 꺼져 있어요' : cam.state === 'insecure' ? 'https 주소에서만 카메라를 쓸 수 있어요' : '카메라를 켤 수 없어요'}</b>
            <span className="small" style={{ opacity: .8 }}>{cam.state === 'denied' ? '주소창 왼쪽 아이콘 → 권한에서 카메라를 허용하거나, 사진을 찍어서 물어보세요.' : '사진을 찍어서 물어볼 수 있어요.'}</span>
            <div className="hstack" style={{ justifyContent: 'center' }}>
              {cam.state === 'denied' && <button className="btn sm" onClick={() => void cam.retry()}><I name="refresh" />다시 시도</button>}
              <button className="btn sm sign" onClick={() => fileRef.current?.click()}><I name="camera" />사진으로 묻기</button>
            </div>
          </div>
        )}
        {cam.state === 'starting' && !photo && <div className="cam-msg"><Dots /><span className="small">카메라를 켜는 중…</span></div>}
        {!dataSaver && <Minimap />}
      </div>
      <div className="cam-bottom">
        {(guide || error || busy) && (
          <div className="guide" aria-live="polite">
            {error ? <div className="say" style={{ fontSize: 15.5 }}>{error}</div> : guide ? (
              <>
                <div className="say">{guide.say}</div>
                {guide.steps && guide.steps.length > 0 && <ol>{guide.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
                {guide.signs && guide.signs.length > 0 && <div className="signs">{guide.signs.map((s, i) => <span key={i} className="sign-tag"><span className="ja" lang="ja">{s.ja}</span>{s.ko}</span>)}</div>}
                {guide.need && <div className="need">📷 {guide.need}</div>}
                <div className="conf">{guide.confidence ? CONF[guide.confidence] : ''}{provider ? ` · ${PROVIDER_LABEL[provider]}` : ''}{busy ? ' · 다시 보는 중…' : ''}</div>
              </>
            ) : <div className="hstack"><Dots /><span className="small">화면을 보고 있어요…</span></div>}
          </div>
        )}
        <div className="cam-ctrls">
          <button className="round" aria-pressed={auto} onClick={toggleAuto} aria-label={auto ? '자동 안내 끄기' : '자동 안내 켜기'}><I name="auto" /></button>
          <button className="cam-go" onClick={() => void ask(null, 'manual')} disabled={busy}>
            {busy ? <Dots /> : <><I name="eye" />{dest ? '이쪽 맞아? 안내받기' : '여기 뭐가 있어?'}</>}
          </button>
          <button className={`round${listening ? ' listening' : ''}`} onClick={() => void askVoice()} aria-label="말로 묻기"><I name="mic" /></button>
        </div>
        <div className="cam-status">
          {auto ? `자동 안내 켜짐 (${autoSec}초)` : '노란 버튼: 지금 화면으로 안내'}
          {since != null ? ` · 마지막 안내 ${since < 60 ? `${since}초` : `${Math.round(since / 60)}분`} 전` : ''}
          {me ? ` · GPS ±${Math.round(me.acc)}m` : ' · GPS 찾는 중'}
        </div>
        <div className="hstack" style={{ justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn sm ghost" style={{ color: '#fff' }} onClick={() => { ui().close('camera'); ui().open({ type: 'live' }); }}><I name="live" />실시간 대화로</button>
          {photo
            ? <button className="btn sm ghost" style={{ color: '#fff' }} onClick={() => setPhoto(null)}><I name="camera" />카메라로 돌아가기</button>
            : <button className="btn sm ghost" style={{ color: '#fff' }} onClick={() => fileRef.current?.click()}><I name="photo" />사진으로 묻기</button>}
          {dest && <button className="btn sm ghost" style={{ color: '#fff' }} onClick={() => ui().open({ type: 'bigtext', lead: 'ここに行きたいです', ja: dest.nameLocal || dest.name, ko: dest.name, addr: dest.address })}><I name="big" />길 물어보기</button>}
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { void pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
