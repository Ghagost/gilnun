/* "Open on your phone" page (QR + address) that the start/deploy scripts open in the PC browser,
 * plus a terminal QR for consoles that can draw it. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { encode, renderSVG } from '../vendor/uqr.mjs';
import { TOOLS, fmtDateKo } from './common.mjs';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Compact QR from half blocks, forced black on white so it also scans on dark terminal themes. */
export function terminalQr(text) {
  const { data, size } = encode(text, { border: 2, ecc: 'L' });
  const dark = (x, y) => y < size && data[y][x];
  const lines = [];
  for (let y = 0; y < size; y += 2) {
    let line = '';
    for (let x = 0; x < size; x++) {
      const top = dark(x, y);
      const bottom = dark(x, y + 1);
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push(`  \x1b[30;107m${line}\x1b[0m`);
  }
  return lines.join('\n');
}

/** Korean fonts in the old Windows console draw block characters double-width, which breaks the code. */
export const terminalQrSafe = () => Boolean(process.stdout.isTTY) && (process.platform !== 'win32' || Boolean(process.env.WT_SESSION));

const NOTES = {
  tunnel: () => [
    '이 주소는 <b>이 PC에서 길눈 창(검은 창)이 켜져 있는 동안만</b> 열려요. 창을 닫으면 꺼지고, 다음에 실행하면 주소가 바뀌어요.',
    'PC를 꺼도 계속 쓰는 주소가 필요하면 폴더의 <b>DEPLOY</b> 파일을 실행하세요.',
  ],
  vercel: () => ['이 주소는 <b>계속 쓸 수 있어요.</b> PC를 꺼도 되고, 폰·PC 어디서든 같은 주소로 열면 돼요.'],
  'vercel-temp': ({ expiresAt, claimUrl }) => [
    `로그인 없이 만든 <b>임시 주소</b>라서 <b>${esc(fmtDateKo(expiresAt))}</b>까지 열려요.`,
    claimUrl
      ? `계속 쓰려면 <a href="${esc(claimUrl)}" target="_blank" rel="noopener">내 Vercel 계정으로 가져오기</a>(무료 가입)를 누르세요. 이 가져오기 링크는 다른 사람에게 보내지 마세요.`
      : '계속 쓰려면 Vercel에 무료 가입한 뒤 DEPLOY 파일을 다시 실행하세요.',
  ],
};

export function writeQrPage({ url, pcUrl, mode = 'tunnel', expiresAt, claimUrl, file = 'phone.html' }) {
  const svg = renderSVG(url, { border: 2, ecc: 'M', pixelSize: 8, blackColor: '#111214', whiteColor: '#ffffff' });
  const notes = NOTES[mode]({ expiresAt, claimUrl });
  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>길눈 — 휴대폰에서 열기</title>
<style>
  :root {
    --sign: #FFD21F; --sign-ink: #111214; --bg: #EEF0EC; --panel: #FFFFFF; --line: #DEE1DB;
    --ink: #15171A; --ink-2: #545B63; --link: #1D5FD6; --warn-soft: #FFF1D6; --warn: #7A4600;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0E1012; --panel: #17191D; --line: #2D3238; --ink: #EEF0F2; --ink-2: #A9B0B8; --link: #7FA9FF;
      --warn-soft: #3A2C12; --warn: #F2C27A; color-scheme: dark; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); padding: 28px 16px 48px; word-break: keep-all; overflow-wrap: anywhere;
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif; }
  main { max-width: 760px; margin: 0 auto; display: grid; gap: 20px; }
  header { display: flex; align-items: center; gap: 12px; }
  .badge { flex: none; white-space: nowrap; background: var(--sign); color: var(--sign-ink); font-weight: 800; letter-spacing: .02em; padding: 6px 12px;
    border-radius: 8px; border: 2px solid var(--sign-ink); font-size: 18px; }
  h1 { font-size: 24px; line-height: 1.3; margin: 0; text-wrap: balance; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 22px;
    display: grid; grid-template-columns: minmax(0, 260px) minmax(0, 1fr); gap: 24px; align-items: center; }
  .qr { background: #fff; border-radius: 14px; padding: 10px; width: 100%; max-width: 260px; aspect-ratio: 1; }
  .qr svg { display: block; width: 100%; height: 100%; }
  .addr { font: 600 17px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace; word-break: break-all; margin: 4px 0 14px; }
  .label { font-size: 12px; font-weight: 700; letter-spacing: .06em; color: var(--ink-2); }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  .btn { appearance: none; border: 1px solid var(--line); background: var(--panel); color: var(--ink); border-radius: 10px;
    padding: 9px 14px; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; }
  .btn.primary { background: var(--sign); color: var(--sign-ink); border-color: var(--sign-ink); }
  ol { margin: 0; padding-left: 22px; display: grid; gap: 6px; }
  .note { background: var(--warn-soft); color: var(--ink); border-radius: 14px; padding: 14px 16px; display: grid; gap: 6px; }
  .note p { margin: 0; }
  a { color: var(--link); }
  @media (max-width: 600px) { .card { grid-template-columns: minmax(0, 1fr); justify-items: center; text-align: center; } .row { justify-content: center; } }
</style>
</head>
<body>
<main>
  <header><span class="badge">길눈</span><h1>휴대폰 카메라로 QR을 찍으세요</h1></header>
  <section class="card">
    <div class="qr" role="img" aria-label="휴대폰용 주소 QR 코드">${svg}</div>
    <div>
      <div class="label">휴대폰·PC 어디서나 여는 주소</div>
      <div class="addr" id="addr">${esc(url)}</div>
      <div class="row">
        <button class="btn" id="copy" type="button">주소 복사</button>
        <a class="btn primary" href="${esc(pcUrl || url)}" target="_blank" rel="noopener">이 PC에서 열기</a>
      </div>
    </div>
  </section>
  <section>
    <ol>
      <li>휴대폰 카메라(갤럭시는 기본 카메라 앱)로 QR을 비추고, 뜨는 주소를 누르세요. 카카오톡으로 주소를 보내도 돼요.</li>
      <li>열리면 Chrome 오른쪽 위 <b>⋮ → 홈 화면에 추가</b>를 누르면 앱처럼 쓸 수 있어요.</li>
      <li>위치·카메라·마이크 권한은 <b>허용</b>을 눌러 주세요. AI는 앱의 <b>도구 → 설정</b>에 Gemini·ChatGPT·Claude 키를 넣으면 돼요.</li>
    </ol>
  </section>
  <section class="note">${notes.map((n) => `<p>${n}</p>`).join('')}</section>
</main>
<script>
  document.getElementById('copy').addEventListener('click', async (e) => {
    const text = document.getElementById('addr').textContent;
    try { await navigator.clipboard.writeText(text); e.target.textContent = '복사했어요'; }
    catch { const r = document.createRange(); r.selectNodeContents(document.getElementById('addr'));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r); e.target.textContent = 'Ctrl+C 로 복사하세요'; }
  });
</script>
</body>
</html>
`;
  mkdirSync(TOOLS, { recursive: true });
  const out = path.join(TOOLS, file);
  writeFileSync(out, html);
  return out;
}
