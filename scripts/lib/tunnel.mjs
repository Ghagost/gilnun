/* Free temporary https address for the phone: Cloudflare Quick Tunnel (no account needed).
 * Downloads the official cloudflared binary once into .tools/ and runs
 *   cloudflared tunnel --url http://127.0.0.1:<port>
 * Quick Tunnels are meant for trying things out: random address, no uptime guarantee.
 * (They buffer GET event-streams; this app streams AI answers over POST, which works.) */
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { TOOLS, fmtBytes, getJson, isWin, sleep } from './common.mjs';

const RELEASES = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
const MAX_AGE_DAYS = 120; // re-download now and then: Cloudflare only supports recent versions

export function assetName(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return arch === 'ia32' ? 'cloudflared-windows-386.exe' : 'cloudflared-windows-amd64.exe'; // arm64 runs the x64 build
  if (platform === 'darwin') return arch === 'arm64' ? 'cloudflared-darwin-arm64.tgz' : 'cloudflared-darwin-amd64.tgz';
  if (platform === 'linux') return { x64: 'cloudflared-linux-amd64', arm64: 'cloudflared-linux-arm64', arm: 'cloudflared-linux-arm', ia32: 'cloudflared-linux-386' }[arch] ?? null;
  return null;
}

export const binPath = () => process.env.CLOUDFLARED_BIN || path.join(TOOLS, isWin ? 'cloudflared.exe' : 'cloudflared');

/** Makes sure cloudflared is available; downloads it (about 40MB) the first time. Returns its path. */
export async function ensureCloudflared(onProgress = () => {}) {
  const bin = binPath();
  if (process.env.CLOUDFLARED_BIN) return bin;
  const have = existsSync(bin);
  if (have && Date.now() - statSync(bin).mtimeMs < MAX_AGE_DAYS * 864e5) return bin;
  const asset = assetName();
  if (!asset) throw new Error(`이 컴퓨터(${process.platform}/${process.arch})는 지원하지 않아요`);
  mkdirSync(TOOLS, { recursive: true });
  const part = path.join(TOOLS, `${asset}.part`);
  try {
    const res = await fetch(RELEASES + asset, { redirect: 'follow', signal: AbortSignal.timeout(300000) });
    if (!res.ok || !res.body) throw new Error(`내려받기 실패 (HTTP ${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    let got = 0;
    let shown = -1;
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        got += chunk.length;
        const pct = total ? Math.floor((got / total) * 10) : -1;
        if (pct !== shown) {
          shown = pct;
          onProgress(total ? `${pct * 10}% (${fmtBytes(got)} / ${fmtBytes(total)})` : fmtBytes(got));
        }
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), meter, createWriteStream(part));
    if (asset.endsWith('.tgz')) {
      execFileSync('tar', ['-xzf', part, '-C', TOOLS]); // the archive holds one file: cloudflared
      rmSync(part, { force: true });
    } else {
      renameSync(part, bin);
    }
    if (!isWin) chmodSync(bin, 0o755);
    const now = new Date();
    utimesSync(bin, now, now);
    return bin;
  } catch (e) {
    rmSync(part, { force: true });
    if (have) return bin; // an older copy still works
    throw e;
  }
}

/**
 * Starts a quick tunnel to the local app. Resolves once the address answers (or at least once
 * cloudflared registered a connection) with { url, verified, child }. Rejects with a readable error.
 */
export function startQuickTunnel(bin, port, { timeout = 60000, grace = 20000, verifyPath = '/api/health' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const log = [];
    let url = null;
    let registered = false;
    let settled = false;
    let verifying = false;
    let buf = '';
    let timer;
    let graceTimer;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      if (err) {
        try {
          child.kill();
        } catch {}
        err.log = log.join('\n');
        reject(err);
      } else resolve(value);
    };

    const verify = async () => {
      if (verifying) return;
      verifying = true;
      while (!settled) {
        const j = await getJson(url + verifyPath, 5000);
        if (j?.ok) return finish(null, { url, verified: true, child, log });
        await sleep(1500);
      }
    };

    const onData = (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trimEnd();
        buf = buf.slice(i + 1);
        log.push(line);
        if (log.length > 80) log.shift();
        const m = line.match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/i);
        if (m && !url) {
          url = m[0].toLowerCase();
          verify();
        }
        if (/Registered tunnel connection/i.test(line)) registered = true;
        // Connected but the PC cannot confirm it (strict DNS, proxy): phones usually still can.
        if (url && registered && !graceTimer) graceTimer = setTimeout(() => finish(null, { url, verified: false, child, log }), grace);
        if (/provisioning failed|failed to request quick tunnel|failed to unmarshal quick tunnel/i.test(line)) {
          finish(new Error('Cloudflare에서 임시 주소를 받지 못했어요'));
        }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => finish(new Error(`cloudflared를 실행하지 못했어요 (${e.code || e.message})`)));
    child.on('exit', (code) => finish(new Error(`cloudflared가 멈췄어요 (code ${code})`)));

    timer = setTimeout(() => {
      finish(new Error(url ? 'Cloudflare에 연결하지 못했어요 (방화벽이 막고 있을 수 있어요)' : '시간이 너무 오래 걸려요'));
    }, timeout);
  });
}
