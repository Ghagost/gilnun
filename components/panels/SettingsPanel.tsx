'use client';

import { useEffect, useRef, useState } from 'react';
import { providerAvailable } from '@/lib/ai/run';
import { runAgent } from '@/lib/ai/agent';
import { aiErrorText } from '@/lib/ai/transport';
import { PROVIDER_LABEL } from '@/lib/ai/types';
import { downloadText } from '@/lib/ics';
import { useChat } from '@/lib/store/chat';
import { useRuntime } from '@/lib/store/runtime';
import { MODEL_CHOICES, useSettings, settings, DEFAULT_MODELS } from '@/lib/store/settings';
import { useTrip } from '@/lib/store/trip';
import { toast } from '@/lib/store/ui';
import type { AiProvider } from '@/lib/types';
import { I } from '../Icons';
import { Dots, ExtLink, PanelHead, ProviderLogo, Seg } from '../ui';

const KEY_HELP: Record<AiProvider, { url: string; hint: string; ph: string }> = {
  openai: { url: 'https://platform.openai.com/api-keys', hint: 'OpenAI Platform에서 결제 수단을 등록하고 키를 만들어요. ChatGPT 구독과는 별도예요.', ph: 'sk-…' },
  anthropic: { url: 'https://platform.claude.com/', hint: 'Claude Console에서 크레딧을 충전하고 키를 만들어요. Claude 앱 구독과는 별도예요.', ph: 'sk-ant-…' },
  gemini: { url: 'https://aistudio.google.com/apikey', hint: 'Google AI Studio에서 무료로 받을 수 있어요(무료 티어는 한도가 있고 입력이 서비스 개선에 쓰일 수 있어요).', ph: 'AIza…' },
};

export function KeyInput({ p }: { p: AiProvider }) {
  const key = useSettings(s => s.keys[p]);
  const [show, setShow] = useState(false);
  const [v, setV] = useState(key);
  useEffect(() => setV(key), [key]);
  return (
    <div className="field">
      <label htmlFor={`key-${p}`}>{PROVIDER_LABEL[p]} API 키 (선택)</label>
      <div className="hstack">
        <input id={`key-${p}`} className="input grow" type={show ? 'text' : 'password'} value={v} placeholder={KEY_HELP[p].ph} autoComplete="off" spellCheck={false} autoCapitalize="off"
          onChange={e => setV(e.target.value)} onBlur={() => settings().setKey(p, v)} />
        <button className="btn icon" onClick={() => setShow(!show)} aria-label={show ? '숨기기' : '보기'}><I name="eye" /></button>
      </div>
      <p className="hint">{KEY_HELP[p].hint} <ExtLink href={KEY_HELP[p].url}>키 받기</ExtLink></p>
    </div>
  );
}

export default function SettingsPanel({ section }: { section?: string }) {
  const s = useSettings();
  const config = useRuntime(r => r.config);
  const engine = useRuntime(r => r.engine);
  const [testing, setTesting] = useState<AiProvider | null>(null);
  const aiRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState(s.accessCode);
  const [gkey, setGkey] = useState(s.googleKey);
  const [fx, setFx] = useState(s.fxManual);

  useEffect(() => {
    const el = section === 'ai' ? aiRef.current : section === 'map' ? mapRef.current : section === 'data' ? dataRef.current : null;
    el?.scrollIntoView({ block: 'start' });
  }, [section]);

  const test = async (p: AiProvider) => {
    setTesting(p);
    try {
      const r = await runAgent({ provider: p, model: s.models[p], system: '짧게 답해.', history: [], text: '연결 테스트야. "OK"라고만 답해.', tools: [], maxTokens: 300 });
      toast(`${PROVIDER_LABEL[p]} 연결됨: ${r.text.slice(0, 30) || 'OK'}`);
    } catch (e) { toast(aiErrorText(e)); } finally { setTesting(null); }
  };

  const exportData = () => {
    const t = useTrip.getState();
    const data = { app: 'gilnun', version: 2, at: new Date().toISOString(), trips: t.trips, saved: t.saved, lists: t.lists, reservations: t.reservations };
    downloadText(`gilnun-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
  };
  const importData = async (f?: File) => {
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.app !== 'gilnun') throw new Error('bad');
      const t = useTrip.getState();
      useTrip.setState({
        trips: [...(j.trips || []).filter((x: { id: string }) => !t.trips.some(y => y.id === x.id)), ...t.trips],
        saved: { ...(j.saved || {}), ...t.saved },
        reservations: [...t.reservations, ...(j.reservations || []).filter((x: { id: string }) => !t.reservations.some(y => y.id === x.id))],
        lists: t.lists.length ? t.lists : j.lists,
      });
      toast('백업을 불러왔어요 (기존 데이터는 유지)');
    } catch { toast('길눈 백업 파일이 아니에요'); }
  };
  const notify = async (on: boolean) => {
    if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const r = await Notification.requestPermission().catch(() => 'denied');
      if (r !== 'granted') { toast('알림 권한이 거부됐어요'); return; }
    }
    settings().set({ notify: on });
  };

  return (
    <div>
      <PanelHead title="설정" />
      <div ref={aiRef} className="set-group">
        <h3>AI 선택</h3>
        <div className="prov-pick">
          {(['openai', 'anthropic', 'gemini'] as AiProvider[]).map(p => (
            <button key={p} aria-pressed={s.provider === p} onClick={() => settings().set({ provider: p })}>
              <ProviderLogo p={p} />{PROVIDER_LABEL[p]}
              <small>{s.keys[p] ? '내 키' : config?.ai?.[p] ? '서버 키' : '키 필요'}</small>
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="model">{PROVIDER_LABEL[s.provider]} 모델</label>
          <select id="model" className="select" value={MODEL_CHOICES[s.provider].some(c => c.id === s.models[s.provider]) ? s.models[s.provider] : '__custom'} onChange={e => { if (e.target.value !== '__custom') settings().setModel(s.provider, e.target.value); }}>
            {MODEL_CHOICES[s.provider].map(c => <option key={c.id} value={c.id}>{c.label} — {c.note}</option>)}
            <option value="__custom">직접 입력…</option>
          </select>
          {!MODEL_CHOICES[s.provider].some(c => c.id === s.models[s.provider]) && (
            <input className="input" defaultValue={s.models[s.provider]} onBlur={e => settings().setModel(s.provider, e.target.value)} placeholder={DEFAULT_MODELS[s.provider]} aria-label="모델 이름" />
          )}
        </div>
        <KeyInput p={s.provider} />
        <div className="hstack">
          <button className="btn grow" onClick={() => test(s.provider)} disabled={!!testing || !providerAvailable(s.provider)}>{testing === s.provider ? <Dots /> : <><I name="check" />연결 테스트</>}</button>
        </div>
        {config?.accessCodeRequired && (
          <div className="field">
            <label htmlFor="code">접속 코드 (서버 키 사용)</label>
            <input id="code" className="input" value={code} onChange={e => setCode(e.target.value)} onBlur={() => settings().set({ accessCode: code.trim() })} placeholder="운영자에게 받은 코드" autoComplete="off" />
          </div>
        )}
        <label className="check"><input type="checkbox" checked={s.webSearch} onChange={e => settings().set({ webSearch: e.target.checked })} />웹 검색으로 최신 정보 확인 (운행 중단·행사·영업시간)</label>
        <label className="check"><input type="checkbox" checked={s.thorough} onChange={e => settings().set({ thorough: e.target.checked })} />꼼꼼하게 생각하기 (느리지만 일정 짜기에 좋아요)</label>
        <p className="hint">내 키는 이 기기에만 저장되고, 요청할 때 이 앱 서버를 거쳐 고른 AI 회사로만 전달돼요 (서버에 저장하지 않아요). 다른 AI의 키도 넣어 두면 AI 버튼에서 바로 바꿀 수 있어요.</p>
        {(['openai', 'anthropic', 'gemini'] as AiProvider[]).filter(p => p !== s.provider).map(p => (
          <details key={p}><summary className="small" style={{ cursor: 'pointer' }}>{PROVIDER_LABEL[p]} 키 {s.keys[p] ? '(입력됨)' : ''}</summary><div style={{ marginTop: 8 }}><KeyInput p={p} /></div></details>
        ))}
      </div>

      <div ref={mapRef} className="set-group">
        <h3>지도</h3>
        <p className="small muted" style={{ margin: 0 }}>지금: {engine === 'google' ? 'Google 지도' : '무료 지도 (OpenStreetMap)'}{config?.google.mapsKey ? ' · 서버에 구글 키 있음' : ''}</p>
        <div className="field">
          <label>지명 표기</label>
          <Seg value={s.mapLang} onChange={v => { settings().set({ mapLang: v }); if (engine === 'google') setTimeout(() => location.reload(), 200); }} options={[{ v: 'ko', label: '한국어 우선' }, { v: 'ja', label: '日本語' }]} />
          {engine === 'google' && <p className="hint">구글 지도는 언어를 바꾸면 앱을 다시 열어요.</p>}
        </div>
        <div className="field">
          <label>화면 테마</label>
          <Seg value={s.theme} onChange={v => settings().set({ theme: v })} options={[{ v: 'auto', label: '자동' }, { v: 'light', label: '밝게' }, { v: 'dark', label: '어둡게' }]} />
        </div>
        <label className="check"><input type="checkbox" checked={s.dataSaver} onChange={e => settings().set({ dataSaver: e.target.checked })} />데이터 절약 (사진·미니맵 끄기, 실시간 영상 덜 보내기)</label>
        <label className="check"><input type="checkbox" checked={s.forceFreeMap} onChange={e => settings().set({ forceFreeMap: e.target.checked })} />무료 지도(OpenStreetMap) 사용</label>
        <div className="field">
          <label htmlFor="gkey">내 Google Maps 키 (선택)</label>
          <input id="gkey" className="input" value={gkey} onChange={e => setGkey(e.target.value)} onBlur={() => settings().set({ googleKey: gkey.trim() })} placeholder="AIza… (Maps JavaScript·Places API 사용 설정)" autoComplete="off" spellCheck={false} />
          <p className="hint">서버에 구글 키가 없을 때만 필요해요. 키는 이 사이트 주소로 HTTP 리퍼러 제한을 걸어 두세요.</p>
        </div>
      </div>

      <div className="set-group">
        <h3>카메라·음성</h3>
        <label className="check"><input type="checkbox" checked={s.voice} onChange={e => settings().set({ voice: e.target.checked })} />카메라 길안내를 소리로 읽어주기</label>
        <div className="field">
          <label htmlFor="auto">자동 안내 간격</label>
          <select id="auto" className="select" value={String(s.autoSec)} onChange={e => settings().set({ autoSec: Number(e.target.value) })}>
            {[6, 10, 15, 20, 30].map(n => <option key={n} value={n}>{n}초 (화면이 바뀔 때만 보내요)</option>)}
          </select>
        </div>
        <label className="check"><input type="checkbox" checked={s.notify} onChange={e => void notify(e.target.checked)} />예약 2시간 전부터 알림 (앱이 열려 있을 때)</label>
      </div>

      <div ref={dataRef} className="set-group">
        <h3>데이터</h3>
        <div className="field">
          <label htmlFor="fx">환율 직접 입력 (1엔당 원, 비우면 자동)</label>
          <input id="fx" className="input" inputMode="decimal" value={fx} onChange={e => setFx(e.target.value)} onBlur={() => settings().set({ fxManual: fx.trim() })} placeholder="예: 9.1" />
        </div>
        <div className="hstack wrap">
          <button className="btn" onClick={exportData}><I name="download" />백업 내보내기</button>
          <label className="btn" style={{ cursor: 'pointer' }}><I name="upload" />백업 불러오기<input type="file" accept="application/json,.json" hidden onChange={e => { void importData(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <button className="btn" onClick={() => { useChat.getState().clear(); toast('대화를 지웠어요'); }}><I name="trash" />대화 지우기</button>
        </div>
        <p className="hint">일정·예약·저장한 곳은 이 기기에만 저장돼요. 기기를 바꿀 때 백업 파일을 쓰세요.</p>
      </div>
    </div>
  );
}
