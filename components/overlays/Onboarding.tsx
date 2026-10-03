'use client';

import { useState } from 'react';
import { providerAvailable } from '@/lib/ai/run';
import { PROVIDER_LABEL } from '@/lib/ai/types';
import { locateOnce, requestCompass, restartGeo } from '@/lib/sensors';
import { useGeo } from '@/lib/store/geo';
import { useRuntime } from '@/lib/store/runtime';
import { settings, useSettings } from '@/lib/store/settings';
import { ui } from '@/lib/store/ui';
import type { AiProvider } from '@/lib/types';
import { BrandMark, I } from '../Icons';
import { KeyInput } from '../panels/SettingsPanel';
import { ProviderLogo } from '../ui';

const FEATS = [
  { icon: 'map', t: '구글 지도 기반 한국어 지도', d: '역·맛집·편의점·숙소·렌터카를 한국어로 찾고, 영업시간과 도착 시각까지 확인해요.' },
  { icon: 'ai', t: 'ChatGPT · Claude · Gemini', d: '원하는 AI에게 물으면 답에 나온 곳이 지도에 번호 핀으로 꽂혀요.' },
  { icon: 'camera', t: '카메라 길안내', d: '복잡한 역·지하·여러 층에서 카메라로 비추면 AI가 표지판을 읽고 방향을 알려줘요.' },
  { icon: 'ticket', t: '예약·일정 한 곳에', d: '예약 사이트 연결, 확인서 자동 입력, 날짜별 일정과 알림까지.' },
];

export default function Onboarding() {
  const [i, setI] = useState(0);
  const me = useGeo(s => s.me);
  const geoError = useGeo(s => s.error);
  const heading = useGeo(s => s.heading);
  const config = useRuntime(s => s.config);
  const install = useRuntime(s => s.installPrompt) as { prompt?: () => Promise<void> } | null;
  const provider = useSettings(s => s.provider);
  useSettings(s => s.keys);
  const [code, setCode] = useState(settings().accessCode);
  const [locating, setLocating] = useState(false);
  const iosCompass = typeof window !== 'undefined' && typeof (window.DeviceOrientationEvent as unknown as { requestPermission?: unknown })?.requestPermission === 'function';
  const serverAi = (['gemini', 'openai', 'anthropic'] as AiProvider[]).filter(p => config?.ai?.[p]);
  const last = 3;

  const finish = () => {
    settings().set({ onboarded: true, accessCode: code.trim() });
    ui().close('onboarding');
  };
  const askLocation = async () => {
    setLocating(true);
    if (geoError === 'denied') restartGeo();
    await locateOnce();
    setLocating(false);
  };

  return (
    <div className="onb" role="dialog" aria-label="길눈 시작하기">
      <div className="slide" style={{ overflowY: 'auto' }}>
        {i === 0 && (
          <>
            <BrandMark size={56} />
            <h1>일본 여행,<br />길눈 하나로</h1>
            <p>지도와 AI, 카메라가 함께 길을 찾아줘요.</p>
            {FEATS.map(f => (
              <div key={f.t} className="feat"><I name={f.icon} className="ic" /><div><b>{f.t}</b><div className="small muted">{f.d}</div></div></div>
            ))}
          </>
        )}
        {i === 1 && (
          <>
            <h1>위치와 방향을<br />켜 주세요</h1>
            <p>지금 있는 곳 주변을 찾고, 화살표로 갈 방향을 보여주는 데만 써요. 위치는 이 기기에만 있고 AI에게 물을 때만 함께 보내요.</p>
            <div className="feat"><I name="locate" className="ic" /><div><b>위치 {me ? <span className="tone-open">켜짐 · ±{Math.round(me.acc)}m</span> : geoError === 'denied' ? <span className="tone-closed">거부됨</span> : ''}</b>
              <div className="small muted">{geoError === 'denied' ? '주소창 왼쪽 아이콘 → 권한 → 위치를 허용한 뒤 다시 눌러 주세요.' : '휴대폰 위치(GPS)를 켜 두면 더 정확해요.'}</div></div></div>
            {!me && <button className="btn primary lg block" onClick={() => void askLocation()} disabled={locating}><I name="locate" />{locating ? '찾는 중…' : '위치 켜기'}</button>}
            <div className="feat"><I name="compass" className="ic" /><div><b>방향 {heading != null ? <span className="tone-open">켜짐</span> : ''}</b><div className="small muted">휴대폰이 향한 쪽을 알아야 카메라 화살표가 맞아요. 이상하면 휴대폰을 8자로 움직여 보정해요.</div></div></div>
            {iosCompass && heading == null && <button className="btn lg block" onClick={() => void requestCompass()}><I name="compass" />방향 센서 켜기</button>}
            <div className="feat"><I name="camera" className="ic" /><div><b>카메라·마이크</b><div className="small muted">카메라 길안내나 음성 질문을 쓸 때만 물어봐요.</div></div></div>
          </>
        )}
        {i === 2 && (
          <>
            <h1>AI 고르기</h1>
            {serverAi.length > 0 ? (
              <p>바로 쓸 수 있어요: {serverAi.map(p => PROVIDER_LABEL[p]).join(', ')}. 기본으로 쓸 AI를 고르세요. 대화 화면에서 언제든 바꿀 수 있어요.</p>
            ) : (
              <p>AI에게 물으려면 키가 필요해요. 키 없이도 지도·검색·길찾기·일정·예약은 다 쓸 수 있어요. 처음이면 무료 티어가 있는 Gemini를 추천해요.</p>
            )}
            <div className="prov-pick">
              {(['gemini', 'openai', 'anthropic'] as AiProvider[]).map(p => (
                <button key={p} aria-pressed={provider === p} onClick={() => settings().set({ provider: p })}>
                  <ProviderLogo p={p} />{PROVIDER_LABEL[p]}<small>{providerAvailable(p) ? '사용 가능' : '키 필요'}</small>
                </button>
              ))}
            </div>
            {!providerAvailable(provider) && <KeyInput p={provider} />}
            {config?.accessCodeRequired && (
              <div className="field">
                <label htmlFor="onb-code">접속 코드 (받았다면)</label>
                <input id="onb-code" className="input" value={code} onChange={e => setCode(e.target.value)} autoComplete="off" />
              </div>
            )}
          </>
        )}
        {i === 3 && (
          <>
            <h1>준비 끝!</h1>
            <p>몇 가지 팁:</p>
            <div className="feat"><I name="search" className="ic" /><div><b>검색은 한국어로</b><div className="small muted">“신주쿠역 동쪽 출구”, “이치란 라멘”처럼 그냥 쓰면 돼요.</div></div></div>
            <div className="feat"><I name="big" className="ic" /><div><b>직원에게 보여주기</b><div className="small muted">장소 화면의 버튼을 누르면 일본어 주소가 크게 떠요. 택시에서 유용해요.</div></div></div>
            <div className="feat"><I name="wifioff" className="ic" /><div><b>인터넷이 끊겨도</b><div className="small muted">일정·예약·저장한 곳은 기기에 있어서 그대로 보여요.</div></div></div>
            {install?.prompt && <button className="btn lg block" onClick={() => { void install.prompt?.(); useRuntime.getState().set({ installPrompt: null }); }}><I name="download" />홈 화면에 앱으로 추가</button>}
          </>
        )}
      </div>
      <div>
        <div className="dots-nav" aria-hidden="true">{[0, 1, 2, 3].map(n => <i key={n} className={n === i ? 'on' : ''} />)}</div>
        <div className="hstack">
          {i > 0 ? <button className="btn lg" onClick={() => setI(i - 1)}>이전</button> : <button className="btn lg ghost" onClick={finish}>건너뛰기</button>}
          <button className="btn primary lg grow" onClick={() => (i === last ? finish() : setI(i + 1))}>{i === last ? '시작하기' : '다음'}</button>
        </div>
      </div>
    </div>
  );
}
