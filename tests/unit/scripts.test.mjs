/* Tests for the double-click helper scripts (scripts/*.mjs). Plain JS: the scripts are plain Node modules. */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fingerprint, fmtDateKo, nodeTooOld } from '../../scripts/lib/common.mjs';
import { terminalQr, writeQrPage } from '../../scripts/lib/qr-page.mjs';
import { assetName, startQuickTunnel } from '../../scripts/lib/tunnel.mjs';
import { parseDeployOutput, validProjectName } from '../../scripts/lib/vercel.mjs';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'gilnun-scripts-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('vercel output', () => {
  it('prefers the public production address over the per-deployment one', () => {
    const out = JSON.stringify({
      id: 'dpl_1',
      url: 'https://gilnun-v2-abc123-team.vercel.app',
      productionUrl: 'https://gilnun-v2.vercel.app',
      readyState: 'READY',
      target: 'production',
      deploymentProtection: ['sso'],
    }, null, 2);
    expect(parseDeployOutput(out)).toMatchObject({ url: 'https://gilnun-v2.vercel.app', readyState: 'READY', expiresAt: undefined });
  });

  it('reads temporary (no login) deployments with expiry and claim link', () => {
    const exp = Date.UTC(2026, 9, 9, 3, 0);
    const out = JSON.stringify({ url: 'https://quiet-river-12.vercel.app', productionUrl: null, inspectorUrl: null, expiresAt: exp, claimUrl: 'https://vercel.com/claim/abc' });
    expect(parseDeployOutput(out)).toMatchObject({ url: 'https://quiet-river-12.vercel.app', expiresAt: exp, claimUrl: 'https://vercel.com/claim/abc' });
  });

  it('handles the agent wrapper, a URL printed before the JSON, and plain text', () => {
    expect(parseDeployOutput(JSON.stringify({ status: 'ok', deployment: { url: 'https://a.vercel.app', productionUrl: 'https://b.vercel.app' } }))?.url).toBe('https://b.vercel.app');
    expect(parseDeployOutput('https://x-1.vercel.app{\n "url": "https://x-1.vercel.app", "productionUrl": "https://x.vercel.app"\n}')?.url).toBe('https://x.vercel.app');
    expect(parseDeployOutput('Deployed to https://plain-9.vercel.app')).toEqual({ url: 'https://plain-9.vercel.app' });
    expect(parseDeployOutput('Error: something')).toBeNull();
    expect(parseDeployOutput('')).toBeNull();
  });

  it('knows which folder names Vercel accepts as project names', () => {
    expect(validProjectName('gilnun-v2')).toBe(true);
    expect(validProjectName('gilnun.app_2')).toBe(true);
    for (const bad of ['Gilnun', '길눈', 'gilnun-v2 (1)', 'a---b', '-x', '']) expect(validProjectName(bad)).toBe(false);
  });
});

describe('tunnel', () => {
  it('maps platforms to the official cloudflared downloads', () => {
    expect(assetName('win32', 'x64')).toBe('cloudflared-windows-amd64.exe');
    expect(assetName('win32', 'arm64')).toBe('cloudflared-windows-amd64.exe');
    expect(assetName('win32', 'ia32')).toBe('cloudflared-windows-386.exe');
    expect(assetName('darwin', 'arm64')).toBe('cloudflared-darwin-arm64.tgz');
    expect(assetName('darwin', 'x64')).toBe('cloudflared-darwin-amd64.tgz');
    expect(assetName('linux', 'x64')).toBe('cloudflared-linux-amd64');
    expect(assetName('linux', 'arm64')).toBe('cloudflared-linux-arm64');
    expect(assetName('freebsd', 'x64')).toBeNull();
  });

  const fake = (name, body) => {
    const p = path.join(tmp, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
    return p;
  };

  it.skipIf(process.platform === 'win32')('returns the address once cloudflared has registered a connection', async () => {
    const bin = fake('cf-ok', [
      'echo "2026-10-02T14:43:59Z INF Requesting new quick Tunnel on trycloudflare.com..." >&2',
      'echo "2026-10-02T14:44:00Z INF |  https://lucky-word-sample-tree.trycloudflare.com                                |" >&2',
      'echo "2026-10-02T14:44:01Z INF Registered tunnel connection connIndex=0 location=icn06 protocol=quic" >&2',
      'sleep 30',
    ].join('\n'));
    const t = await startQuickTunnel(bin, 3999, { timeout: 8000, grace: 1500 });
    try {
      expect(t.url).toBe('https://lucky-word-sample-tree.trycloudflare.com');
      expect(t.verified).toBe(false); // the sandbox cannot reach it; phones can
    } finally {
      t.child.kill();
    }
  });

  it.skipIf(process.platform === 'win32')('fails clearly when Cloudflare refuses, ignoring the API address in errors', async () => {
    const bin = fake('cf-fail', [
      'echo "INF Requesting new quick Tunnel on trycloudflare.com..." >&2',
      'echo \'ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: i/o timeout\' >&2',
      'sleep 30',
    ].join('\n'));
    await expect(startQuickTunnel(bin, 3999, { timeout: 5000 })).rejects.toThrow('임시 주소를 받지 못했어요');
  });

  it.skipIf(process.platform === 'win32')('fails when the address never gets a connection (blocked network)', async () => {
    const bin = fake('cf-blocked', [
      'echo "INF |  https://blocked-network-sample.trycloudflare.com  |" >&2',
      'echo "ERR Failed to dial a quic connection error=\"timeout: no recent network activity\"" >&2',
      'sleep 30',
    ].join('\n'));
    await expect(startQuickTunnel(bin, 3999, { timeout: 2500, grace: 1000 })).rejects.toThrow('Cloudflare에 연결하지 못했어요');
  });

  it.skipIf(process.platform === 'win32')('fails when cloudflared exits early', async () => {
    const bin = fake('cf-exit', 'echo "quick tunnel provisioning failed with status 403" >&2\nexit 1');
    await expect(startQuickTunnel(bin, 3999, { timeout: 5000 })).rejects.toThrow(/임시 주소를 받지 못했어요|멈췄어요/);
  });
});

describe('qr', () => {
  it('draws a terminal QR as black on white half blocks', () => {
    const q = terminalQr('https://lucky-word-sample-tree.trycloudflare.com');
    const lines = q.split('\n');
    const plain = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));
    const width = plain[0].length;
    expect(lines.length).toBeGreaterThan(10);
    expect(plain.every((l) => l.length === width)).toBe(true);
    expect(lines.every((l) => l.includes('\x1b[30;107m'))).toBe(true);
  });

  it('writes an escaped phone page with the QR and the right note', () => {
    const file = writeQrPage({ url: 'https://a-b.trycloudflare.com/?x=<b>', pcUrl: 'http://localhost:3000', mode: 'tunnel', file: 'test-phone.html' });
    try {
      const html = readFileSync(file, 'utf8');
      expect(html).toContain('<svg');
      expect(html).toContain('https://a-b.trycloudflare.com/?x=&lt;b&gt;');
      expect(html).not.toContain('?x=<b>');
      expect(html).toContain('http://localhost:3000');
      expect(html).toContain('켜져 있는 동안만');
    } finally {
      rmSync(file, { force: true });
    }
    const exp = Date.UTC(2026, 9, 9, 3, 0);
    const temp = writeQrPage({ url: 'https://q.vercel.app', mode: 'vercel-temp', expiresAt: exp, claimUrl: 'https://vercel.com/claim/abc', file: 'test-temp.html' });
    try {
      const html = readFileSync(temp, 'utf8');
      expect(html).toContain(fmtDateKo(exp));
      expect(html).toContain('https://vercel.com/claim/abc');
    } finally {
      rmSync(temp, { force: true });
    }
  });
});

describe('helpers', () => {
  it('checks the Node.js version Next.js needs', () => {
    expect(nodeTooOld('18.20.4')).toBe(true);
    expect(nodeTooOld('20.8.1')).toBe(true);
    expect(nodeTooOld('20.9.0')).toBe(false);
    expect(nodeTooOld('24.1.0')).toBe(false);
  });

  it('fingerprints sources so edits trigger a rebuild', () => {
    const root = path.join(tmp, 'proj');
    for (const [p, body] of [['app/page.tsx', 'a'], ['app/x/y.ts', 'b'], ['next.config.ts', 'c']]) {
      mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
      writeFileSync(path.join(root, p), body);
    }
    const entries = ['app', 'next.config.ts', '.env'];
    const a = fingerprint(entries, root);
    expect(fingerprint(entries, root)).toBe(a);
    writeFileSync(path.join(root, 'app/x/y.ts'), 'bb');
    const b = fingerprint(entries, root);
    expect(b).not.toBe(a);
    writeFileSync(path.join(root, '.env'), 'KEY=1');
    const c = fingerprint(entries, root);
    expect(c).not.toBe(b);
    const later = new Date(Date.now() + 5000);
    utimesSync(path.join(root, 'next.config.ts'), later, later);
    expect(fingerprint(entries, root)).not.toBe(c);
  });
});
