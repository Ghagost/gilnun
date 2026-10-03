'use client';

import { useRuntime } from '@/lib/store/runtime';
import { PanelHead } from '../ui';

export default function AboutPanel() {
  const config = useRuntime(s => s.config);
  return (
    <div className="stack">
      <PanelHead title="길눈 정보" />
      <div className="card soft stack" style={{ gap: 6 }}>
        <b style={{ fontSize: 17 }}>길눈 2.0</b>
        <span className="small muted">일본 여행 지도 + AI(ChatGPT·Claude·Gemini) + 실시간 카메라 길안내. 서버 {config?.version || '-'}</span>
      </div>
      <div>
        <h3 className="sec">개인정보</h3>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>일정·예약·저장한 곳·대화는 이 기기 브라우저에만 저장돼요.</li>
          <li>AI에게 물어볼 때 질문, 현재 위치(좌표), 첨부 사진이 고른 AI 회사로 전달돼요.</li>
          <li>카메라 화면은 버튼을 누르거나 실시간 대화 중일 때만 AI로 보내요.</li>
          <li>내 API 키는 이 기기에 저장되고, 요청마다 이 앱 서버를 거쳐 전달될 뿐 서버에 저장하지 않아요.</li>
        </ul>
      </div>
      <div>
        <h3 className="sec">데이터 출처</h3>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>지도·장소: Google Maps Platform (Maps JavaScript, Places, Routes, Maps Grounding Lite) / OpenStreetMap 기여자 (OpenFreeMap, Overpass, Nominatim, Photon)</li>
          <li>일본 열차 경로: NAVITIME (RapidAPI, 설정된 경우)</li>
          <li>날씨: Open-Meteo · 지진: P2P地震情報 (일본 기상청 데이터) · 환율: Frankfurter (ECB)</li>
          <li>글꼴: Pretendard (SIL OFL 1.1) · 지도 엔진: MapLibre GL JS (BSD)</li>
        </ul>
      </div>
      <p className="tiny faint">AI 답변·요금·시간은 틀릴 수 있어요. 열차 시각과 영업시간은 현지 안내를 우선하세요.</p>
    </div>
  );
}
