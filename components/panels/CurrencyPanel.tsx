'use client';

import { useState } from 'react';
import { fxRate } from '@/lib/ai/prompts';
import { fmtWon } from '@/lib/format';
import { useRuntime } from '@/lib/store/runtime';
import { useSettings } from '@/lib/store/settings';
import { ui } from '@/lib/store/ui';
import { I } from '../Icons';
import { PanelHead } from '../ui';

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', '⌫'];

export default function CurrencyPanel() {
  useRuntime(s => s.fx);
  const manual = useSettings(s => s.fxManual);
  const fx = useRuntime(s => s.fx);
  const [dir, setDir] = useState<'jpy' | 'krw'>('jpy');
  const [val, setVal] = useState('1000');
  const rate = fxRate();
  const n = Number(val || 0);
  const out = dir === 'jpy' ? n * rate : n / rate;

  const press = (k: string) => {
    if (k === '⌫') setVal(v => v.slice(0, -1));
    else setVal(v => (v === '0' ? k.replace(/^0+/, '') || '0' : (v + k).slice(0, 10)));
  };

  return (
    <div>
      <PanelHead title="환율 계산기" />
      <div className="calc">
        <div className="disp">
          <span className="from">{dir === 'jpy' ? `¥ ${n.toLocaleString('ko-KR')}` : `${n.toLocaleString('ko-KR')} 원`}</span>
          <span className="to">{dir === 'jpy' ? `${Math.round(out).toLocaleString('ko-KR')} 원` : `¥ ${Math.round(out).toLocaleString('ko-KR')}`}</span>
          <span className="small muted">{dir === 'jpy' ? `약 ${fmtWon(out)}` : ''}</span>
        </div>
        <div className="hstack">
          <button className="btn grow" onClick={() => { setDir(dir === 'jpy' ? 'krw' : 'jpy'); setVal(String(Math.round(out)) || '0'); }}><I name="exchange" />{dir === 'jpy' ? '엔 → 원' : '원 → 엔'} (바꾸기)</button>
          <button className="btn" onClick={() => setVal('0')}>지우기</button>
        </div>
        <div className="hstack wrap" style={{ gap: 6 }}>
          {(dir === 'jpy' ? [500, 1000, 3000, 5000, 10000] : [10000, 50000, 100000]).map(v => (
            <button key={v} className="chip flat" onClick={() => setVal(String(v))}>{dir === 'jpy' ? `¥${v.toLocaleString()}` : `${v / 10000}만 원`}</button>
          ))}
        </div>
        <div className="keys">{KEYS.map(k => <button key={k} onClick={() => press(k)} aria-label={k === '⌫' ? '지우기' : k}>{k}</button>)}</div>
        <p className="small muted" style={{ margin: 0 }}>
          1엔 = {rate.toFixed(3)}원 · {Number(manual) > 0 ? '직접 입력한 환율' : fx ? `${fx.source}${fx.date ? `, ${fx.date}` : ''}` : '기본값 (인터넷 연결 시 자동 갱신)'}
          {' · '}<button className="btn link" style={{ minHeight: 0, padding: 0, fontSize: 'inherit' }} onClick={() => ui().push({ type: 'settings', section: 'data' })}>직접 입력</button>
        </p>
        <div className="card soft small">
          <b>면세 팁</b><br />
          같은 날 같은 가게에서 일반 물품·소모품(화장품·식품) 각각 <b>¥5,000 이상(세금 제외)</b>이면 면세가 돼요. 여권이 꼭 필요해요. 카드 결제 시 해외 결제 수수료(보통 1~2%)가 붙어요.
        </div>
      </div>
    </div>
  );
}
