'use client';

import { useRuntime } from '@/lib/store/runtime';
import { ui } from '@/lib/store/ui';
import { I } from '../Icons';
import { PanelHead } from '../ui';

const TOOLS: { type: 'phrases' | 'interpreter' | 'currency' | 'weather' | 'safety' | 'settings' | 'diagnostics' | 'about'; title: string; sub: string; icon: string; color: string }[] = [
  { type: 'phrases', title: '회화 카드', sub: '직원·택시 기사에게 크게 보여주고 읽어주기', icon: 'big', color: '#0B5FB0' },
  { type: 'interpreter', title: '통역', sub: '말하면 일본어로, 상대 말은 한국어로', icon: 'translate', color: '#6E46C6' },
  { type: 'currency', title: '환율 계산기', sub: '엔 ↔ 원, 면세 기준까지', icon: 'yen', color: '#8A6A00' },
  { type: 'weather', title: '날씨', sub: '지금 위치 · 시간별 비 소식', icon: 'sun', color: '#E0531B' },
  { type: 'safety', title: '안전·긴급', sub: '110·119, 영사콜센터, 지진 정보', icon: 'sos', color: '#C2372D' },
  { type: 'settings', title: '설정', sub: 'AI 선택·키, 지도, 음성', icon: 'gear', color: '#4A525B' },
  { type: 'diagnostics', title: '연결 진단', sub: 'GPS·카메라·지도·AI 점검', icon: 'check', color: '#17864C' },
  { type: 'about', title: '길눈 정보', sub: '버전·데이터 출처·개인정보', icon: 'info', color: '#4A525B' },
];

export default function ToolsPanel() {
  const install = useRuntime(s => s.installPrompt) as { prompt?: () => Promise<void> } | null;
  return (
    <div>
      <PanelHead title="도구" back={false} />
      <div className="tool-grid">
        <button className="tool" style={{ ['--c' as string]: '#111214', background: 'var(--sign)', color: 'var(--sign-ink)' }} onClick={() => ui().open({ type: 'camera' })}>
          <I name="camera" /><b>카메라 길안내</b><span style={{ color: 'inherit', opacity: 0.75 }}>표지판을 읽고 방향을 알려줘요</span>
        </button>
        <button className="tool" style={{ ['--c' as string]: '#111214' }} onClick={() => ui().open({ type: 'live' })}>
          <I name="live" /><b>실시간 카메라 대화</b><span>영상·음성으로 AI와 대화</span>
        </button>
        {TOOLS.map(t => (
          <button key={t.type} className="tool" style={{ ['--c' as string]: t.color }} onClick={() => ui().push({ type: t.type })}>
            <I name={t.icon} /><b>{t.title}</b><span>{t.sub}</span>
          </button>
        ))}
      </div>
      {install?.prompt && (
        <button className="btn primary block" style={{ marginTop: 14 }} onClick={() => { void install.prompt?.(); useRuntime.getState().set({ installPrompt: null }); }}>
          <I name="download" />홈 화면에 앱으로 설치
        </button>
      )}
    </div>
  );
}
