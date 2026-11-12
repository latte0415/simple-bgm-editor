import type { Analysis } from '../state/types';

export type GridSetting = 'auto' | 'bar' | '1/4' | '1/8' | '1/16' | '1/32';

export const GRID_OPTIONS: { value: GridSetting; label: string }[] = [
  { value: 'auto', label: '자동' },
  { value: 'bar', label: '1 마디' },
  { value: '1/4', label: '1/4' },
  { value: '1/8', label: '1/8' },
  { value: '1/16', label: '1/16' },
  { value: '1/32', label: '1/32' },
];

/** Grid subdivisions per beat. Values below 1 mean "every 1/div beats" (bars). */
const DIV: Record<Exclude<GridSetting, 'auto'>, number> = {
  bar: 0.25,
  '1/4': 1,
  '1/8': 2,
  '1/16': 4,
  '1/32': 8,
};

/** Finest grid whose lines are at least `minPx` apart. 0 = too dense to draw. */
export function autoDiv(pxPerBeat: number, minPx = 14): number {
  if (!(pxPerBeat > 0)) return 0;
  if (pxPerBeat * 16 < minPx) return 0;
  if (pxPerBeat * 4 < minPx) return 1 / 16;
  if (pxPerBeat < minPx) return 0.25;
  let d = 1;
  while (d < 16 && pxPerBeat / (d * 2) >= minPx) d *= 2;
  return d;
}

export function resolveDiv(setting: GridSetting, pxPerBeat: number): number {
  return setting === 'auto' ? autoDiv(pxPerBeat) : DIV[setting];
}

/** Grid density used for drawing: the chosen grid, thinned out if lines would collide. */
export function displayDiv(setting: GridSetting, pxPerBeat: number): number {
  const auto = autoDiv(pxPerBeat);
  if (setting === 'auto') return auto;
  const fine = autoDiv(pxPerBeat, 6);
  return Math.min(DIV[setting], fine);
}

/** Beat k's time, linearly extrapolated outside the detected range. */
export function beatTime(beats: number[], k: number): number {
  const m = beats.length;
  if (k < 0) return beats[0] + k * (beats[1] - beats[0]);
  if (k >= m) return beats[m - 1] + (k - m + 1) * (beats[m - 1] - beats[m - 2]);
  return beats[k];
}

/** Fractional beat index at time t. */
export function beatIndexAt(beats: number[], t: number): number {
  const m = beats.length;
  if (t < beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
  if (t >= beats[m - 1]) return m - 1 + (t - beats[m - 1]) / (beats[m - 1] - beats[m - 2]);
  let lo = 0;
  let hi = m - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);
}

export function beatLengthAt(an: Analysis, t: number): number {
  if (an.beats.length < 2) return an.bpm > 0 ? 60 / an.bpm : 0.5;
  const k = Math.floor(beatIndexAt(an.beats, t));
  return beatTime(an.beats, k + 1) - beatTime(an.beats, k);
}

export interface GridLine {
  t: number;
  /** 0 = bar, 1 = beat, 2 = subdivision */
  level: 0 | 1 | 2;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

export function gridLines(an: Analysis, t0: number, t1: number, div: number): GridLine[] {
  const { beats, downbeatPhase: ph } = an;
  if (beats.length < 2 || div <= 0) return [];
  const k0 = Math.floor(beatIndexAt(beats, t0)) - 1;
  const k1 = Math.ceil(beatIndexAt(beats, t1)) + 1;
  const out: GridLine[] = [];
  if (div < 1) {
    const step = Math.round(1 / div);
    for (let k = k0 - mod(k0 - ph, step); k <= k1; k += step) {
      const t = beatTime(beats, k);
      if (t >= t0 && t <= t1) out.push({ t, level: 0 });
    }
    return out;
  }
  for (let k = k0; k <= k1; k++) {
    const a = beatTime(beats, k);
    const b = beatTime(beats, k + 1);
    const bar = mod(k - ph, 4) === 0;
    for (let j = 0; j < div; j++) {
      const t = a + ((b - a) * j) / div;
      if (t < t0 || t > t1) continue;
      out.push({ t, level: j === 0 ? (bar ? 0 : 1) : 2 });
    }
  }
  return out;
}

export function nearestGrid(an: Analysis, t: number, div: number): number | null {
  const { beats, downbeatPhase: ph } = an;
  if (beats.length < 2 || div <= 0) return null;
  const k = Math.floor(beatIndexAt(beats, t));
  if (div < 1) {
    const step = Math.round(1 / div);
    const kb = k - mod(k - ph, step);
    const a = beatTime(beats, kb);
    const b = beatTime(beats, kb + step);
    return t - a <= b - t ? a : b;
  }
  const a = beatTime(beats, k);
  const b = beatTime(beats, k + 1);
  const j = Math.round(((t - a) / (b - a)) * div);
  return a + ((b - a) * j) / div;
}

/** Beats between two source times (fractional). */
export function beatsBetween(an: Analysis, a: number, b: number): number {
  if (an.beats.length < 2) return 0;
  return beatIndexAt(an.beats, b) - beatIndexAt(an.beats, a);
}
