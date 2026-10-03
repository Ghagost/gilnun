/* Parsing helpers for the Vercel CLI output used by scripts/deploy.mjs (kept separate for tests). */

export function parseJsonLoose(out = '') {
  const s = out.indexOf('{');
  const e = out.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(out.slice(s, e + 1));
  } catch {
    return null;
  }
}

/** Reads `vercel deploy --format=json` output (also tolerates a bare URL line before the JSON). */
export function parseDeployOutput(out = '') {
  const j = parseJsonLoose(out);
  const d = j?.deployment ?? j;
  if (d && (d.productionUrl || d.url)) {
    const exp = typeof d.expiresAt === 'number' || typeof d.expiresAt === 'string' ? new Date(d.expiresAt).getTime() : NaN;
    return {
      url: d.productionUrl || d.url,
      expiresAt: Number.isFinite(exp) ? exp : undefined,
      claimUrl: d.claimUrl || undefined,
      readyState: d.readyState,
    };
  }
  const m = out.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/i);
  return m ? { url: m[0] } : null;
}

/** Vercel project names: lowercase letters, digits, . _ -; the CLI uses the folder name by default. */
export const validProjectName = (name) => /^[a-z0-9][a-z0-9._-]{0,99}$/.test(name) && !name.includes('---');
