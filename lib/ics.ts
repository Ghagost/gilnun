export type IcsEvent = {
  uid: string;
  start: Date;
  end?: Date;
  title: string;
  location?: string;
  description?: string;
  url?: string;
  /** Minutes before start for a reminder (0 = none). */
  alarmMin?: number;
};

const pad = (n: number) => String(n).padStart(2, '0');
function utc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
/** Folds a content line to 75 octets (UTF-8), continuing with a leading space. */
export function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length ? 74 : 75;
    if (curBytes + b > limit) { out.push(cur); cur = ''; curBytes = 0; }
    cur += ch; curBytes += b;
  }
  out.push(cur);
  return out.map((l, i) => (i ? ' ' + l : l)).join('\r\n');
}

export function buildIcs(events: IcsEvent[], calName = '길눈 여행'): string {
  const now = utc(new Date());
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gilnun//Travel//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(calName)}`];
  for (const e of events) {
    if (!(e.start instanceof Date) || Number.isNaN(e.start.getTime())) continue;
    const end = e.end && e.end.getTime() > e.start.getTime() ? e.end : new Date(e.start.getTime() + 60 * 60000);
    lines.push('BEGIN:VEVENT', `UID:${esc(e.uid)}@gilnun`, `DTSTAMP:${now}`, `DTSTART:${utc(e.start)}`, `DTEND:${utc(end)}`, `SUMMARY:${esc(e.title)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.alarmMin && e.alarmMin > 0) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, `TRIGGER:-PT${Math.round(e.alarmMin)}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Triggers a download of text content (works on Android Chrome; iOS opens a preview). */
export function downloadText(filename: string, text: string, mime = 'text/calendar;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
