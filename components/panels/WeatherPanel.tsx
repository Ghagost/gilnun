'use client';

import { useEffect, useState } from 'react';
import { loadWeather } from '@/lib/boot';
import { fmtDateKo, parseJst, relTimeKo } from '@/lib/format';
import { useGeo } from '@/lib/store/geo';
import { useRuntime } from '@/lib/store/runtime';
import { I } from '../Icons';
import { Dots, Empty, PanelHead, weatherIcon, weatherText } from '../ui';

export default function WeatherPanel() {
  const w = useRuntime(s => s.weather);
  const me = useGeo(s => s.me);
  const area = useGeo(s => s.area);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (me && !w) void loadWeather(); }, [me, w]);
  const refresh = async () => { setBusy(true); await loadWeather(true); setBusy(false); };

  const rainSoon = w?.hours.find(h => (h.pop ?? 0) >= 50);
  const cold = w?.current.temp != null && w.current.temp < 8;
  const hot = w?.current.temp != null && w.current.temp > 30;

  return (
    <div>
      <PanelHead title="날씨">
        <button className="icon-btn" onClick={refresh} aria-label="새로고침" disabled={busy}><I name="refresh" className={busy ? 'spin' : ''} /></button>
      </PanelHead>
      {!me && !w ? <Empty icon="locate">위치를 알면 지금 있는 곳의 날씨를 보여줘요.</Empty> : !w ? <Dots /> : (
        <div className="stack lg">
          <div className="wx-now">
            <I name={weatherIcon(w.current.code)} style={{ width: 52, height: 52 }} />
            <span className="t">{w.current.temp != null ? Math.round(w.current.temp) : '-'}°</span>
            <div className="grow">
              <b>{weatherText(w.current.code)}</b>
              <div className="small muted">체감 {w.current.feels != null ? Math.round(w.current.feels) : '-'}° · 바람 {w.current.wind != null ? Math.round(w.current.wind) : '-'}km/h{w.current.humidity != null ? ` · 습도 ${w.current.humidity}%` : ''}</div>
              <div className="tiny faint">{area?.label || ''} · {relTimeKo(w.at)} 업데이트</div>
            </div>
          </div>
          {(rainSoon || cold || hot) && (
            <div className="card soft small">
              {rainSoon && <div>☂ {rainSoon.time}쯤 비 올 확률 {rainSoon.pop}% — 편의점 우산(¥500~800)을 챙기세요.</div>}
              {cold && <div>🧥 쌀쌀해요. 겉옷을 챙기세요.</div>}
              {hot && <div>🥤 더워요. 물을 자주 마시고 그늘에서 쉬세요.</div>}
            </div>
          )}
          <div>
            <h3 className="sec">시간별</h3>
            <div className="wx-hours" data-nodrag>
              {w.hours.map(h => (
                <div key={h.time} className="wx-h">
                  <span>{h.time}</span>
                  <I name={weatherIcon(h.code)} />
                  <b>{h.temp != null ? Math.round(h.temp) : '-'}°</b>
                  <span className="pop">{h.pop != null ? `${h.pop}%` : ''}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="sec">며칠 예보</h3>
            {w.days.map(d => (
              <div key={d.date} className="wx-day">
                <span>{parseJst(d.date) ? fmtDateKo(parseJst(d.date)!).replace(/^\d+월 /, '') : d.date}</span>
                <I name={weatherIcon(d.code)} />
                <span className="small muted">{weatherText(d.code)}{d.pop != null ? ` · 비 ${d.pop}%` : ''}</span>
                <span><b>{d.max != null ? Math.round(d.max) : '-'}°</b> <span className="muted">{d.min != null ? Math.round(d.min) : '-'}°</span></span>
              </div>
            ))}
          </div>
          <p className="tiny faint">날씨 데이터 Open-Meteo</p>
        </div>
      )}
    </div>
  );
}
