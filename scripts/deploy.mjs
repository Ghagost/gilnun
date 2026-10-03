#!/usr/bin/env node
/**
 * 길눈 — 폰·PC 어디서나 열리는 https 주소 만들기 (무료 Vercel).
 * DEPLOY-Windows.bat / DEPLOY-Mac.command 를 더블클릭하면 이 파일이 실행돼요.
 *
 *   node scripts/deploy.mjs              Vercel에 로그인돼 있으면 내 계정으로, 아니면 방법을 물어봐요
 *   node scripts/deploy.mjs --login      Vercel 로그인 후 계속 쓰는 주소
 *   node scripts/deploy.mjs --temporary  로그인 없이 임시 주소 (나중에 내 계정으로 가져올 수 있어요)
 *
 * 다시 실행하면 같은 프로젝트(같은 주소)로 업데이트돼요.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { ROOT, bold, cyan, dim, fail, fmtDateKo, ok, openUrl, requireNode, rule, run, say, step, warn } from './lib/common.mjs';
import { terminalQr, terminalQrSafe, writeQrPage } from './lib/qr-page.mjs';
import { parseDeployOutput, parseJsonLoose, validProjectName } from './lib/vercel.mjs';

const VERCEL = 'vercel@62';
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const vercel = (list, opts = {}) => run('npx', ['--yes', VERCEL, ...list], { ...opts, env: { VERCEL_TELEMETRY_DISABLED: '1', ...opts.env } });

async function whoami() {
  const r = await vercel(['whoami', '--format=json'], { stdout: 'pipe' });
  const j = parseJsonLoose(r.out);
  if (r.code !== 0 || !j || j.loggedIn === false) return null;
  return j.username || j.email || 'Vercel';
}

/** Names of filled-in secrets in local .env files (those files are not uploaded, see .vercelignore). */
function localSecretNames() {
  const names = new Set();
  for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    let text = '';
    try {
      text = readFileSync(path.join(ROOT, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(\S.*)?$/);
      if (m && m[2] && !m[2].startsWith('#') && /KEY|TOKEN|SECRET|ACCESS_CODE/.test(m[1])) names.add(m[1]);
    }
  }
  return [...names];
}

async function ask(question, fallback) {
  if (!process.stdin.isTTY) return fallback;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim() || fallback;
  } finally {
    rl.close();
    process.stdin.pause();
  }
}

async function main() {
  requireNode();
  process.chdir(ROOT);
  console.log();
  say(`${bold('길눈')} ${dim('— 폰·PC 어디서나 열리는 주소 만들기 (무료 Vercel)')}`);
  rule();

  step('Vercel 연결 확인 중… (처음이면 도구를 내려받아서 조금 걸려요)');
  let mode = flag('temporary') ? 'temp' : flag('login') ? 'login' : null;
  const user = mode === 'temp' ? null : await whoami();
  if (user) {
    ok(`Vercel 계정(${user})으로 올려요. 계속 쓰는 주소가 생겨요.`);
    mode = 'account';
  } else if (!mode) {
    say('어떻게 올릴지 골라 주세요.');
    say(`  ${bold('1')}  로그인하고 계속 쓰는 주소 만들기 ${dim('(추천 · 무료 · Google/GitHub로 1분)')}`);
    say(`  ${bold('2')}  로그인 없이 바로 임시 주소 만들기 ${dim('(정해진 기간이 지나면 꺼져요)')}`);
    const answer = await ask('  번호를 누르고 Enter (그냥 Enter = 1): ', '1');
    mode = answer.startsWith('2') ? 'temp' : 'login';
  }

  if (mode === 'login') {
    step('Vercel 로그인 — 브라우저가 열리면 로그인하고 허용(Allow)을 눌러 주세요');
    const r = await vercel(['login']);
    if (r.code !== 0) {
      fail('로그인하지 못했어요. 다시 실행하거나 2번(임시 주소)을 골라 보세요.');
      return 1;
    }
  }

  const keys = localSecretNames();
  if (keys.length) {
    warn(`PC의 .env 파일에 있는 키(${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ' 등' : ''})는 안전을 위해 올리지 않아요.`);
    say(dim('서버 키로 쓰려면 Vercel 프로젝트 → Settings → Environment Variables에 넣으세요. 아니면 기기마다 앱 설정에 내 키를 넣으면 돼요.'));
  }

  step('Vercel에 올리는 중… (2~4분)');
  const deployArgs = ['deploy', '--prod', '--yes', '--format=json'];
  if (mode === 'temp') deployArgs.push('--temporary');
  if (!validProjectName(path.basename(ROOT))) deployArgs.push('--name', 'gilnun');
  const r = await vercel(deployArgs, { stdout: 'pipe' });
  const info = parseDeployOutput(r.out);
  if (r.code !== 0 || !info?.url) {
    fail('올리지 못했어요. 위에 나온 메시지를 확인해 주세요.');
    say(dim('인터넷 연결을 확인하고 다시 실행해 보세요. 계속 안 되면 README의 "GitHub로 올리기" 방법을 쓰면 돼요.'));
    return 1;
  }

  const temp = Boolean(info.expiresAt);
  console.log();
  rule();
  ok(`완료! 주소: ${cyan(info.url)}`);
  if (temp) {
    warn(`로그인 없이 만든 임시 주소라서 ${fmtDateKo(info.expiresAt)}까지 열려요.`);
    if (info.claimUrl) say("계속 쓰려면 브라우저에 띄운 페이지에서 '내 Vercel 계정으로 가져오기'를 누르세요 (무료 가입).");
  }
  try {
    writeFileSync(path.join(ROOT, '길눈-주소.txt'), `${info.url}\n${temp ? `임시 주소 — ${fmtDateKo(info.expiresAt)}까지\n` : ''}`);
  } catch {}
  const page = writeQrPage({
    url: info.url,
    pcUrl: info.url,
    mode: temp ? 'vercel-temp' : 'vercel',
    expiresAt: info.expiresAt,
    claimUrl: info.claimUrl,
    file: 'deploy.html',
  });
  openUrl(page);
  if (terminalQrSafe()) {
    console.log();
    console.log(terminalQr(info.url));
  }
  say('휴대폰은 QR을 찍거나, 주소를 카카오톡 등으로 보내서 여세요. (주소는 길눈-주소.txt 에도 적어 뒀어요)');
  say(dim('코드를 고친 뒤 이 파일을 다시 실행하면 같은 주소로 업데이트돼요.'));
  rule();
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    fail(`예상하지 못한 문제가 생겼어요: ${e?.message || e}`);
    process.exit(1);
  },
);
