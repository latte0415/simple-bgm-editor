export function fmtTime(t: number): string {
  const total = Math.round(Math.max(0, t) * 1000);
  const m = Math.floor(total / 60000);
  const rest = total - m * 60000;
  const s = Math.floor(rest / 1000);
  const ms = rest % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export function fmtShort(t: number): string {
  const total = Math.round(Math.max(0, t));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export const dbToGain = (db: number) => (db <= -60 ? 0 : Math.pow(10, db / 20));

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

let n = 0;
export const uid = (prefix: string) => `${prefix}_${(Date.now() % 1e8).toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
