'use client';

import { useEffect, useState } from 'react';
import { runAgent } from '@/lib/ai/agent';
import { providerAvailable } from '@/lib/ai/run';
import { aiErrorText } from '@/lib/ai/transport';
import { PROVIDER_LABEL } from '@/lib/ai/types';
import { api } from '@/lib/api';
import { searchCategory } from '@/lib/places';
import { hasVoice, speechSupported } from '@/lib/speech';
import { useGeo } from '@/lib/store/geo';
import { useRuntime } from '@/lib/store/runtime';
import { settings } from '@/lib/store/settings';
import type { AiProvider } from '@/lib/types';
import { I } from '../Icons';
import { PanelHead } from '../ui';

type Status = 'ok' | 'bad' | 'warn' | 'wait';
type Row = { id: string; title: string; status: Status; detail: string };

const ICON: Record<Status, string> = { ok: 'check', bad: 'alert', warn: 'alert', wait: 'clock' };

function DiagRow({ r }: { r: Row }) {
  return (
    <div className="diag">
      <I name={ICON[r.status]} className={r.status} />
      <div><b>{r.title}</b><span>{r.detail}</span></div>
    </div>
  );
}

const GOOGLE_HELP: Record<string, string> = {
  auth_failed: '키가 잘못됐거나 이 주소가 허용 목록(HTTP 리퍼러)에 없어요. Google Cloud 콘솔 → 사용자 인증 정보에서 이 사이트 주소를 추가하고, Maps JavaScript API·Places API (New)·Routes API를 사용 설정하고, 결제 계정을 연결하세요.',
  timeout: '구글 지도를 불러오는 데 시간이 너무 걸렸어요. 인터넷 연결을 확인하세요.',
};

export default function DiagnosticsPanel() {
  const me = useGeo(s => s.me);
  const geoError = useGeo(s => s.error);
  const heading = useGeo(s => s.heading);
  const config = useRuntime(s => s.config);
  const configError = useRuntime(s => s.configError);
  const engine = useRuntime(s => s.engine);
  const googleState = useRuntime(s => s.googleState);
  const googleError = useRuntime(s => s.googleError);
  const [auto, setAuto] = useState<Row[]>([]);
  const [manual, setManual] = useState<Record<string, Row>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows: Row[] = [];
      const check = async (id: string, title: string, fn: () => Promise<string>) => {
        try { rows.push({ id, title, status: 'ok', detail: await fn() }); } catch (e) { rows.push({ id, title, status: 'bad', detail: String((e as Error).message || e).slice(0, 160) }); }
      };
      await check('health', '앱 서버', async () => { await api('/api/health', { timeout: 6000 }); return '정상'; });
      await check('fx', '환율', async () => { const j = await api<{ rate: number; source: string }>('/api/fx'); return `1엔 = ${j.rate.toFixed(3)}원 (${j.source})`; });
      await check('quake', '지진 정보', async () => { const j = await api<{ quakes: unknown[] }>('/api/quake'); return `최근 ${j.quakes.length}건 수신`; });
      if (me) await check('weather', '날씨', async () => { await api(`/api/weather?lat=${me.lat.toFixed(2)}&lng=${me.lng.toFixed(2)}`); return '정상'; });
      let idb = 'ok';
      try { indexedDB.open('gl-test').onerror = () => { idb = 'bad'; }; } catch { idb = 'bad'; }
      let persisted = false;
      try { persisted = await navigator.storage?.persisted?.() ?? false; if (!persisted) persisted = await navigator.storage?.persist?.() ?? false; } catch { /* ignore */ }
      rows.push({ id: 'storage', title: '저장 공간', status: idb === 'ok' ? 'ok' : 'bad', detail: idb === 'ok' ? `IndexedDB 사용 가능${persisted ? ' · 영구 저장 허용됨' : ' · 브라우저가 공간이 부족하면 지울 수 있어요 (백업 권장)'}` : '이 브라우저(사생활 보호 모드?)에서는 일정·예약이 저장되지 않을 수 있어요' });
      if (alive) setAuto(rows);
    })();
    return () => { alive = false; };
  }, [me?.lat ? 1 : 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (r: Row) => setManual(m => ({ ...m, [r.id]: r }));
  const testAi = async (p: AiProvider) => {
    set({ id: `ai-${p}`, title: `${PROVIDER_LABEL[p]} 대화`, status: 'wait', detail: '확인 중…' });
    try {
      const r = await runAgent({ provider: p, model: settings().models[p], system: '짧게 답해.', history: [], text: '"OK"라고만 답해.', tools: [], maxTokens: 300 });
      set({ id: `ai-${p}`, title: `${PROVIDER_LABEL[p]} 대화`, status: 'ok', detail: `${settings().models[p]} 응답: ${r.text.slice(0, 40)}` });
    } catch (e) { set({ id: `ai-${p}`, title: `${PROVIDER_LABEL[p]} 대화`, status: 'bad', detail: aiErrorText(e) }); }
  };
  const testLive = async (p: 'openai' | 'gemini') => {
    const id = `live-${p}`, title = `${p === 'openai' ? 'ChatGPT Realtime' : 'Gemini Live'} 실시간 연결 준비`;
    set({ id, title, status: 'wait', detail: '확인 중…' });
    try {
      const j = await api<{ model: string }>(`/api/live/${p}`, { method: 'POST', body: JSON.stringify({}), headers: settings().keys[p] ? { 'x-user-key': settings().keys[p] } : undefined });
      set({ id, title, status: 'ok', detail: `임시 토큰 발급됨 (${j.model})` });
    } catch (e) { set({ id, title, status: 'bad', detail: (e as Error).message }); }
  };
  const testPlaces = async () => {
    set({ id: 'places', title: '주변 검색', status: 'wait', detail: '확인 중…' });
    try {
      const c = me || { lat: 35.6896, lng: 139.7006 };
      const r = await searchCategory('conv', c);
      set({ id: 'places', title: '주변 검색', status: r.places.length ? 'ok' : 'warn', detail: `${r.provider === 'google' ? 'Google Places' : 'OpenStreetMap'} · 편의점 ${r.places.length}곳${'fallback' in r && r.fallback ? ` (구글 실패: ${String(r.fallback).slice(0, 80)})` : ''}` });
    } catch (e) { set({ id: 'places', title: '주변 검색', status: 'bad', detail: (e as Error).message }); }
  };
  const testTransit = async () => {
    set({ id: 'transit', title: '일본 열차 경로', status: 'wait', detail: '확인 중…' });
    try {
      const now = new Date();
      const at = `${now.toISOString().slice(0, 10)}T12:00`;
      const j = await api<{ routes: unknown[] }>(`/api/transit?from=35.681236,139.767125&to=35.689634,139.700565&at=${at}`);
      set({ id: 'transit', title: '일본 열차 경로', status: j.routes.length ? 'ok' : 'warn', detail: `도쿄역→신주쿠역 ${j.routes.length}개 경로` });
    } catch (e) { set({ id: 'transit', title: '일본 열차 경로', status: 'bad', detail: (e as Error).message }); }
  };
  const testDevice = async (kind: 'camera' | 'mic') => {
    const id = `dev-${kind}`, title = kind === 'camera' ? '카메라' : '마이크';
    try {
      const st = await navigator.mediaDevices.getUserMedia(kind === 'camera' ? { video: { facingMode: { ideal: 'environment' } } } : { audio: true });
      st.getTracks().forEach(t => t.stop());
      set({ id, title, status: 'ok', detail: '사용 가능' });
    } catch (e) {
      set({ id, title, status: 'bad', detail: (e as Error).name === 'NotAllowedError' ? '권한이 거부됐어요. 주소창 왼쪽 아이콘 → 권한에서 허용하세요.' : `사용할 수 없어요 (${(e as Error).name})` });
    }
  };

  const base: Row[] = [
    { id: 'https', title: '보안 연결 (https)', status: window.isSecureContext ? 'ok' : 'bad', detail: window.isSecureContext ? '정상' : 'https 주소에서만 위치·카메라·마이크가 켜져요' },
    { id: 'gps', title: '위치 (GPS)', status: me ? 'ok' : geoError ? 'bad' : 'wait', detail: me ? `정확도 ±${Math.round(me.acc)}m` : geoError === 'denied' ? '권한 거부됨 — 사이트 설정에서 위치 허용' : geoError ? `사용 불가 (${geoError})` : '찾는 중…' },
    { id: 'compass', title: '나침반', status: heading != null ? 'ok' : 'warn', detail: heading != null ? `방향 ${Math.round(heading)}°` : '방향 센서 신호가 없어요 (휴대폰을 8자로 움직여 보정해 보세요)' },
    { id: 'config', title: '서버 설정', status: configError ? 'warn' : config ? 'ok' : 'wait', detail: config ? `AI 서버 키: ${(['openai', 'anthropic', 'gemini'] as AiProvider[]).filter(p => config.ai[p]).map(p => PROVIDER_LABEL[p]).join(', ') || '없음'} · 열차 경로 ${config.transit ? '켜짐' : '꺼짐'} · 구글 그라운딩 ${config.google.grounding ? '켜짐' : '꺼짐'}${config.accessCodeRequired ? ' · 접속 코드 필요' : ''}` : '불러오는 중…' },
    { id: 'map', title: '지도', status: engine === 'google' ? 'ok' : googleState === 'error' ? 'bad' : engine ? 'warn' : 'wait', detail: engine === 'google' ? 'Google 지도 정상' : googleState === 'error' ? (GOOGLE_HELP[googleError || ''] || `구글 지도 오류: ${googleError}`) + ' (지금은 무료 지도로 동작 중)' : engine === 'maplibre' ? '무료 지도(OpenStreetMap) 사용 중 — 구글 키를 넣으면 구글 지도로 바뀌어요' : '불러오는 중…' },
    { id: 'speech', title: '음성 인식·읽기', status: speechSupported() ? 'ok' : 'warn', detail: `${speechSupported() ? '음성 인식 가능' : '음성 인식 미지원 (입력은 키보드로)'} · 한국어 음성 ${hasVoice('ko-KR') ? '있음' : '없음'} · 일본어 음성 ${hasVoice('ja-JP') ? '있음' : '없음'}` },
    { id: 'notify', title: '알림', status: typeof Notification === 'undefined' ? 'warn' : Notification.permission === 'granted' ? 'ok' : 'warn', detail: typeof Notification === 'undefined' ? '이 브라우저는 알림을 지원하지 않아요' : Notification.permission === 'granted' ? '허용됨' : '꺼져 있어요 (설정에서 예약 알림을 켜면 요청해요)' },
  ];

  return (
    <div>
      <PanelHead title="연결 진단" />
      {[...base, ...auto].map(r => <DiagRow key={r.id} r={r} />)}
      {Object.values(manual).map(r => <DiagRow key={r.id} r={r} />)}
      <h3 className="sec">직접 확인 (요금이 조금 들 수 있어요)</h3>
      <div className="hstack wrap" style={{ gap: 6 }}>
        <button className="btn sm" onClick={() => testDevice('camera')}><I name="camera" />카메라</button>
        <button className="btn sm" onClick={() => testDevice('mic')}><I name="mic" />마이크</button>
        <button className="btn sm" onClick={testPlaces}><I name="search" />주변 검색</button>
        {config?.transit && <button className="btn sm" onClick={testTransit}><I name="train" />열차 경로</button>}
        {(['openai', 'anthropic', 'gemini'] as AiProvider[]).filter(providerAvailable).map(p => <button key={p} className="btn sm" onClick={() => testAi(p)}><I name="ai" />{PROVIDER_LABEL[p]}</button>)}
        {providerAvailable('gemini') && <button className="btn sm" onClick={() => testLive('gemini')}><I name="live" />Gemini Live</button>}
        {providerAvailable('openai') && <button className="btn sm" onClick={() => testLive('openai')}><I name="live" />ChatGPT 실시간</button>}
      </div>
    </div>
  );
}
