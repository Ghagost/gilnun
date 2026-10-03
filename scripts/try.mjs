#!/usr/bin/env node
/**
 * 길눈 — 내 PC에서 바로 써보기 (+ 휴대폰은 QR로).
 * START-Windows.bat / START-Mac.command 를 더블클릭하면 이 파일이 실행돼요.
 *
 *   node scripts/try.mjs              필요할 때만 설치·빌드 → 실행 → 브라우저 열기 → 휴대폰용 임시 주소(QR)
 *   node scripts/try.mjs --no-phone   휴대폰용 주소 없이 이 PC에서만
 *   node scripts/try.mjs --rebuild    코드를 고친 뒤 강제로 다시 빌드
 *   node scripts/try.mjs --port 3100  다른 포트로 실행 (기본 3000)
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ROOT, TOOLS, bold, cyan, dim, fail, fingerprint, getJson, hashFile, isPortFree, ok, openUrl, progress, progressEnd,
  readStamp, requireNode, rule, run, say, step, waitFor, warn, writeStamp,
} from './lib/common.mjs';
import { terminalQr, terminalQrSafe, writeQrPage } from './lib/qr-page.mjs';
import { ensureCloudflared, startQuickTunnel } from './lib/tunnel.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const BUILD_INPUTS = ['app', 'components', 'lib', 'public', 'next.config.ts', 'package-lock.json', 'tsconfig.json', '.env', '.env.local', '.env.production', '.env.production.local'];
const children = new Set();
let stopping = false;

function stopAll() {
  stopping = true;
  for (const c of children) {
    try {
      c.kill();
    } catch {}
  }
}
process.on('exit', stopAll);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    stopAll();
    console.log('\n  길눈을 껐어요.');
    process.exit(0);
  });
}

async function install() {
  const lock = path.join(ROOT, 'package-lock.json');
  const stamp = path.join(ROOT, 'node_modules', '.gilnun-install');
  const want = hashFile(lock);
  if (existsSync(path.join(ROOT, 'node_modules', 'next', 'package.json')) && readStamp(stamp) === want) return true;
  step('필요한 부품 설치 중… (처음 한 번만, 1~3분)');
  const r = await run('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], {
    env: { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', NEXT_TELEMETRY_DISABLED: '1' },
  });
  if (r.code !== 0) {
    fail('설치하지 못했어요. 인터넷 연결을 확인하고 다시 실행해 보세요.');
    return false;
  }
  writeStamp(stamp, want);
  ok('설치 완료');
  return true;
}

async function build() {
  const stamp = path.join(ROOT, '.next', '.gilnun-build');
  const want = fingerprint(BUILD_INPUTS);
  if (!flag('rebuild') && existsSync(path.join(ROOT, '.next', 'BUILD_ID')) && readStamp(stamp) === want) return true;
  step('앱 만드는 중… (1~3분)');
  const r = await run(process.execPath, [NEXT_BIN, 'build'], { env: { NEXT_TELEMETRY_DISABLED: '1' } });
  if (r.code !== 0) {
    fail('앱을 만들지 못했어요. 위에 나온 오류를 확인해 주세요.');
    return false;
  }
  writeStamp(stamp, fingerprint(BUILD_INPUTS)); // after the build: it may touch tsconfig.json
  ok('준비 완료');
  return true;
}

/** Picks the port; returns null when 길눈 already runs there (then that copy is reused). */
async function pickPort(preferred) {
  const health = await getJson(`http://127.0.0.1:${preferred}/api/health`, 1500);
  if (health?.app === 'gilnun') return null;
  if (await isPortFree(preferred)) return preferred;
  for (let p = preferred + 1; p < preferred + 30; p++) {
    if (await isPortFree(p)) {
      warn(`${preferred}번 포트를 다른 프로그램이 쓰고 있어서 ${p}번으로 열어요.`);
      say(dim('주소(포트)가 바뀌면 브라우저에 저장한 일정·설정이 따로 보여요.'));
      return p;
    }
  }
  throw new Error('빈 포트를 찾지 못했어요. --port 로 다른 번호를 지정해 보세요.');
}

async function startServer(port) {
  step('길눈 켜는 중…');
  mkdirSync(TOOLS, { recursive: true });
  const logPath = path.join(TOOLS, 'server.log');
  const log = createWriteStream(logPath, { flags: 'w' });
  const server = spawn(process.execPath, [NEXT_BIN, 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: ROOT,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.add(server);
  server.stdout.pipe(log, { end: false });
  server.stderr.pipe(log, { end: false });
  let exited = null;
  let started = false;
  server.on('exit', (code) => {
    exited = code ?? 1;
    if (!stopping && started) {
      fail(`길눈 서버가 멈췄어요 (code ${exited}). 자세한 내용: ${logPath}`);
      stopAll();
      process.exit(1);
    }
  });
  const up = await waitFor(async () => exited !== null || (await getJson(`http://127.0.0.1:${port}/api/health`, 2000))?.ok, { timeout: 90000 });
  if (!up || exited !== null) {
    fail('길눈을 켜지 못했어요.');
    try {
      const tail = readFileSync(logPath, 'utf8').trim().split('\n').slice(-12).join('\n');
      if (tail) console.log(dim(tail.replace(/^/gm, '    ')));
    } catch {}
    return false;
  }
  started = true;
  return true;
}

async function startPhone(port, pcUrl) {
  step('휴대폰에서 열 주소 만드는 중… (무료 임시 주소)');
  try {
    const bin = await ensureCloudflared((p) => progress(`연결 도구 내려받는 중 ${p}`));
    progressEnd();
    const t = await startQuickTunnel(bin, port);
    children.add(t.child);
    t.child.on('exit', () => {
      if (!stopping) warn('휴대폰용 주소 연결이 끊겼어요. 이 창을 닫고 START를 다시 실행하면 새 주소가 생겨요.');
    });
    const page = writeQrPage({ url: t.url, pcUrl, mode: 'tunnel' });
    ok(`휴대폰 주소: ${cyan(t.url)}`);
    if (!t.verified) say(dim('(이 PC에서는 주소 확인을 못 했어요. 휴대폰에서 열어 보세요.)'));
    openUrl(page);
    if (terminalQrSafe()) {
      console.log();
      console.log(terminalQr(t.url));
    }
    return t.url;
  } catch (e) {
    progressEnd();
    warn(`휴대폰용 주소를 만들지 못했어요: ${e.message}`);
    say(dim('이 PC에서는 그대로 쓸 수 있어요. 휴대폰에서 쓰려면 DEPLOY 파일(무료 Vercel 주소)을 써 보세요.'));
    if (e.log) {
      try {
        writeFileSync(path.join(TOOLS, 'tunnel.log'), e.log);
      } catch {}
    }
    return null;
  }
}

async function main() {
  requireNode();
  process.chdir(ROOT);
  console.log();
  say(`${bold('길눈')} ${dim('— 내 PC에서 바로 써보기')}`);
  rule();

  const preferred = Number(option('port')) || 3000;
  const port = await pickPort(preferred);
  if (port === null) {
    const url = `http://localhost:${preferred}`;
    ok(`길눈이 이미 다른 창에서 실행 중이에요 → ${cyan(url)}`);
    say('그 창을 계속 쓰면 돼요. 브라우저로 열어 둘게요.');
    openUrl(url);
    return 3;
  }

  if (!(await install())) return 1;
  if (!(await build())) return 1;
  if (!(await startServer(port))) return 1;

  const pcUrl = `http://localhost:${port}`;
  ok(`이 PC 주소: ${cyan(pcUrl)}`);
  openUrl(pcUrl);

  const phoneUrl = flag('no-phone') ? null : await startPhone(port, pcUrl);

  console.log();
  rule();
  say(bold('길눈 실행 중'));
  say(`이 PC   ${cyan(pcUrl)}`);
  if (phoneUrl) say(`휴대폰  ${cyan(phoneUrl)}  ${dim('(브라우저에 QR을 띄웠어요)')}`);
  say(dim('끝내려면 이 창을 닫으세요 (또는 Ctrl+C).'));
  rule();
  return 0;
}

main().then(
  (code) => {
    if (code !== 0) {
      stopAll();
      process.exitCode = code;
    }
  },
  (e) => {
    fail(`예상하지 못한 문제가 생겼어요: ${e?.message || e}`);
    stopAll();
    process.exitCode = 1;
  },
);
