'use client';

import { useEffect } from 'react';
import { runCategory } from '@/lib/actions';
import { loadQuakes } from '@/lib/boot';
import { fmtDateKo, fmtHM } from '@/lib/format';
import { googlePlace } from '@/lib/links';
import { useGeo } from '@/lib/store/geo';
import { useRuntime } from '@/lib/store/runtime';
import { toast, ui } from '@/lib/store/ui';
import { I } from '../Icons';
import { ExtLink, PanelHead } from '../ui';

const SOS_CARDS = [
  { ja: '助けてください！救急車を呼んでください', ko: '도와주세요! 구급차를 불러 주세요' },
  { ja: '警察を呼んでください', ko: '경찰을 불러 주세요' },
  { ja: 'パスポートをなくしました。近くの交番はどこですか？', ko: '여권을 잃어버렸어요. 가까운 파출소는 어디예요?' },
  { ja: '道に迷いました。この場所に行きたいです', ko: '길을 잃었어요. 이곳에 가고 싶어요' },
];

function scaleClass(s: number) {
  if (s >= 70) return 's7';
  if (s >= 55) return 's6';
  if (s >= 45) return 's5';
  if (s >= 40) return 's4';
  return '';
}

export default function SafetyPanel() {
  const quakes = useRuntime(s => s.quakes);
  const me = useGeo(s => s.me);
  useEffect(() => { void loadQuakes(); }, []);

  const shareLocation = async () => {
    if (!me) { toast('위치를 아직 몰라요'); return; }
    const url = googlePlace({ lat: me.lat, lng: me.lng, name: `${me.lat.toFixed(5)},${me.lng.toFixed(5)}` });
    const text = `지금 내 위치 (정확도 ±${Math.round(me.acc)}m)`;
    try { if (navigator.share) { await navigator.share({ title: '내 위치', text, url }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('위치 링크를 복사했어요'); } catch { toast('공유하지 못했어요'); }
  };

  return (
    <div>
      <PanelHead title="안전·긴급" />
      <div className="sos">
        <a href="tel:110"><b>110</b><span>경찰 (사건·사고·분실)</span></a>
        <a href="tel:119"><b>119</b><span>구급차·화재 (한국어 통역 연결 가능)</span></a>
        <a className="alt" href="tel:+82232100404"><b>+82-2-3210-0404</b><span>영사콜센터 (24시간, 한국 외교부)</span></a>
        <a className="alt" href="tel:05038162787"><b>050-3816-2787</b><span>일본 관광청 방문객 핫라인 (24시간, 한국어)</span></a>
      </div>
      <div className="hstack wrap" style={{ gap: 6, marginTop: 12 }}>
        <button className="btn" onClick={() => void runCategory('hospital')}><I name="cross" />가까운 병원</button>
        <button className="btn" onClick={() => void runCategory('police')}><I name="shield" />파출소(交番)</button>
        <button className="btn" onClick={() => void runCategory('pharmacy')}><I name="pharmacy" />약국</button>
        <button className="btn" onClick={shareLocation}><I name="share" />내 위치 보내기</button>
      </div>

      <h3 className="sec">보여주기 카드</h3>
      <div className="stack" style={{ gap: 6 }}>
        {SOS_CARDS.map(c => (
          <button key={c.ja} className="btn ghost block" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => ui().open({ type: 'bigtext', ja: c.ja, ko: c.ko, lead: '' })}>
            <I name="big" /><span><span lang="ja" className="ja">{c.ja}</span><br /><span className="small muted">{c.ko}</span></span>
          </button>
        ))}
      </div>

      <h3 className="sec">최근 지진 (일본 기상청 발표)</h3>
      {quakes.length === 0 ? <p className="small muted">불러오는 중이거나 최근 정보가 없어요.</p> : quakes.slice(0, 8).map(q => (
        <div key={q.id} className="quake">
          <span className={`sc ${scaleClass(q.maxScale)}`}>{q.scaleText.replace('정보 없음', '-')}</span>
          <div style={{ minWidth: 0 }}>
            <b className="ja" lang="ja">{q.place || '震源 不明'}</b>
            <div className="small muted">{fmtDateKo(new Date(q.time))} {fmtHM(new Date(q.time))}{q.magnitude != null ? ` · 규모 ${q.magnitude}` : ''}{q.tsunami === 'None' ? ' · 쓰나미 걱정 없음' : q.tsunami === 'Warning' || q.tsunami === 'Watch' ? ' · 쓰나미 주의/경보' : ''}</div>
          </div>
        </div>
      ))}
      <div className="card soft small" style={{ marginTop: 12 }}>
        <b>지진이 나면</b>
        <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          <li>머리를 보호하고 튼튼한 테이블 아래로. 흔들림이 멈출 때까지 움직이지 마세요.</li>
          <li>바닷가라면 바로 높은 곳으로 (쓰나미). 엘리베이터는 타지 마세요.</li>
          <li>역·지하에서는 직원 안내를 따르세요. 열차는 안전 확인 후 다시 운행해요.</li>
        </ol>
      </div>
      <div className="stack" style={{ marginTop: 12, gap: 6 }}>
        <ExtLink href="https://www.0404.go.kr/" className="btn block"><I name="globe" />외교부 해외안전여행</ExtLink>
        <ExtLink href="https://overseas.mofa.go.kr/jp-ko/index.do" className="btn block"><I name="globe" />주일본 대한민국 대사관 (공관 연락처)</ExtLink>
        <ExtLink href="https://play.google.com/store/apps/details?id=jp.co.rcsc.safetyTips.android" className="btn block"><I name="download" />일본 관광청 재난 알림 앱 “Safety tips” (한국어 지원)</ExtLink>
        <ExtLink href="https://www.japan.travel/en/plan/emergencies/" className="btn block"><I name="globe" />JNTO 일본 여행 안전 안내</ExtLink>
      </div>
      <p className="tiny faint" style={{ marginTop: 10 }}>지진 정보 P2P地震情報 (일본 기상청 데이터). 공관별 긴급 연락처는 대사관 홈페이지에서 확인하세요.</p>
    </div>
  );
}
