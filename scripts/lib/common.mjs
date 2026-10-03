/* Shared helpers for the double-click scripts (START-*, DEPLOY-*). Plain Node, no dependencies. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TOOLS = path.join(ROOT, '.tools');
export const isWin = process.platform === 'win32';
export const isMac = process.platform === 'darwin';
export const NODE_MIN = [20, 9];

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const bold = paint('1');
export const dim = paint('2');
export const red = paint('31');
export const green = paint('32');
export const yellow = paint('33');
export const cyan = paint('36');

// Symbols that exist in Korean console fonts too (legacy Windows console uses 굴림체 etc.).
export const say = (msg = '') => console.log(msg ? `  ${msg}` : '');
export const step = (msg) => console.log(`\n  ${yellow('▶')} ${bold(msg)}`);
export const ok = (msg) => console.log(`  ${green('●')} ${msg}`);
export const warn = (msg) => console.log(`  ${yellow('※')} ${msg}`);
export const fail = (msg) => console.log(`  ${red('×')} ${msg}`);
export const rule = () => console.log(dim('  ' + '-'.repeat(56)));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function nodeTooOld(version = process.versions.node) {
  const [maj, min] = version.split('.').map(Number);
  return maj < NODE_MIN[0] || (maj === NODE_MIN[0] && min < NODE_MIN[1]);
}

/** Exits with a friendly message when Node.js is older than Next.js needs. */
export function requireNode() {
  if (!nodeTooOld()) return;
  fail(`설치된 Node.js(${process.versions.node})가 너무 오래됐어요. ${NODE_MIN.join('.')} 이상이 필요해요.`);
  say('방금 열린 페이지에서 LTS 버전을 설치한 뒤 다시 실행하세요.');
  openUrl('https://nodejs.org/ko/download');
  process.exit(1);
}

/** Runs npm/npx/a binary with the terminal attached. Resolves the exit code (never rejects). */
export function run(cmd, args = [], { cwd = ROOT, env = {}, stdout = 'inherit' } = {}) {
  return new Promise((resolve) => {
    const viaShell = isWin && /^(npm|npx)$/.test(cmd);
    // On Windows npm/npx are .cmd files, which Node only starts through a shell. Pass one string
    // (arguments here are fixed tokens without spaces) so newer Node versions don't warn.
    const child = viaShell
      ? spawn([cmd, ...args].join(' '), { cwd, env: { ...process.env, ...env }, stdio: ['inherit', stdout, 'inherit'], shell: true })
      : spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['inherit', stdout, 'inherit'] });
    let out = '';
    if (stdout === 'pipe') child.stdout.on('data', (d) => (out += d));
    child.on('error', (error) => resolve({ code: -1, error, out }));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

/** Opens a URL or a local file in the default browser. Best effort. */
export function openUrl(target) {
  try {
    const child = isWin
      ? spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${target}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore', windowsHide: true })
      : spawn(isMac ? 'open' : 'xdg-open', [target], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function answers(port, host) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.setTimeout(800);
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('timeout', () => {
      s.destroy();
      resolve(false);
    });
    s.once('error', () => resolve(false));
  });
}

function canBind(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

/**
 * Free for us = nothing answers on IPv4 or IPv6 loopback and we can bind 127.0.0.1. (Windows lets two
 * programs share a port on different addresses, and browsers may try ::1 first for "localhost".)
 */
export async function isPortFree(port) {
  if ((await answers(port, '127.0.0.1')) || (await answers(port, '::1'))) return false;
  return canBind(port, '127.0.0.1');
}

export async function getJson(url, timeoutMs = 4000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Polls until `check()` is truthy or the time runs out. */
export async function waitFor(check, { timeout = 60000, interval = 500 } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return true;
    await sleep(interval);
  }
  return false;
}

/**
 * Fingerprint of files/folders (path, size, mtime), walking folders recursively. Compared with the
 * value saved after the last build, so changed sources trigger a rebuild even when unzipping left
 * odd timestamps (zip files keep local times without a time zone).
 */
export function fingerprint(entries, root = ROOT) {
  const parts = [];
  const visit = (p) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const name of readdirSync(p).sort()) if (name !== 'node_modules' && !name.startsWith('.')) visit(path.join(p, name));
    } else parts.push(`${path.relative(root, p)}:${st.size}:${Math.floor(st.mtimeMs)}`);
  };
  for (const e of entries) visit(path.join(root, e));
  return createHash('sha1').update(parts.join('\n')).digest('hex');
}

export const hashFile = (p) => (existsSync(p) ? createHash('sha1').update(readFileSync(p)).digest('hex') : '');

export function readStamp(p) {
  try {
    return readFileSync(p, 'utf8').trim();
  } catch {
    return '';
  }
}

export function writeStamp(p, value) {
  try {
    writeFileSync(p, value);
  } catch {}
}

/** Rewrites one terminal line in place (progress), no-op when output is not a terminal. */
export function progress(text) {
  if (process.stdout.isTTY) process.stdout.write(`\r  ${dim(text)}\x1b[K`);
}
export function progressEnd() {
  if (process.stdout.isTTY) process.stdout.write('\r\x1b[K');
}

export function fmtBytes(n) {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`;
}

export function fmtDateKo(ms) {
  const d = new Date(ms);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${days[d.getDay()]}) ${hh}:${mm}`;
}
