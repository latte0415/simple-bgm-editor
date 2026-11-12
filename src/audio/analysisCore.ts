/**
 * Tempo map + beat tracking.
 *
 * 1. Log-magnitude spectral flux onset envelope (≈86 frames/s at 22 kHz).
 * 2. Global tempo from a prior-weighted autocorrelation, then local tempo
 *    per 8 s window (limited to ±40 % of the global tempo to avoid octave flips).
 * 3. Dynamic-programming beat tracker (Ellis 2007) with the time-varying period.
 * 4. Beats are split into constant-tempo segments; steady segments are
 *    replaced by a least-squares fit so the grid is free of frame jitter.
 */
import type { Analysis, TempoSegment } from '../state/types';

const N = 1024;
const H = 256;
/** Shift beat marks slightly ahead of the detected onset so cuts don't land inside a transient. */
const LEAD = 0.004;

export function analyzeSamples(x: Float32Array, sr: number, duration: number): Analysis {
  const fps = sr / H;
  const { onset, low, lowMid } = onsetEnvelope(x, sr);
  const n = onset.length;
  const empty: Analysis = { beats: [], segments: [{ start: 0, end: duration, bpm: 0 }], downbeatPhase: 0, bpm: 0 };
  if (n < fps * 6) return empty;

  const minLag = Math.max(2, Math.floor((fps * 60) / 210));
  const maxLag = Math.ceil((fps * 60) / 55);
  const globalLag = estimateLag(onset, 0, n, minLag, maxLag, 120, 1.0, fps);
  const period = localPeriods(onset, fps, minLag, maxLag, globalLag);
  let frames = trackBeats(onset, period, 100);
  frames = fixHalfBeatPhase(frames, lowMid).map((f) => refinePeak(onset, f));

  const toTime = (f: number) => (f * H + N / 2) / sr - LEAD;
  let beats = frames.map(toTime).filter((t) => t >= 0 && t < duration);
  if (beats.length < 8) return { ...empty, bpm: round1((60 * fps) / globalLag) };

  const bounds = segmentBeats(beats);
  beats = regularize(beats, bounds);
  const segments = buildSegments(beats, bounds, duration);
  const downbeatPhase = findDownbeat(beats, low, sr);
  const bpm = round1(60 / median(diffs(beats)));
  return { beats, segments, downbeatPhase, bpm };
}

/* ---------------------------------------------------------------- onset */

function onsetEnvelope(x: Float32Array, sr: number) {
  const fft = makeFFT(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const nFrames = x.length >= N ? Math.floor((x.length - N) / H) + 1 : 0;
  const half = N / 2;
  const binHz = sr / N;

  // Log-spaced bands so the many high-frequency bins don't outweigh kick/snare.
  const F0 = 40;
  const F1 = Math.min(11000, sr / 2);
  const NB = 36;
  const bandOf = new Int16Array(half + 1).fill(-1);
  for (let k = 1; k <= half; k++) {
    const f = k * binHz;
    if (f >= F0 && f < F1) bandOf[k] = Math.min(NB - 1, Math.floor((Math.log(f / F0) / Math.log(F1 / F0)) * NB));
  }
  const bandHz = (b: number) => F0 * Math.pow(F1 / F0, (b + 1) / NB);
  const band = new Float64Array(NB);
  const prev = new Float64Array(NB);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const flux = new Float32Array(nFrames);
  const low = new Float32Array(nFrames);
  const lowMid = new Float32Array(nFrames);

  for (let f = 0; f < nFrames; f++) {
    const o = f * H;
    for (let i = 0; i < N; i++) {
      re[i] = x[o + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    band.fill(0);
    for (let k = 1; k <= half; k++) {
      const b = bandOf[k];
      if (b >= 0) band[b] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
    let s = 0;
    let sl = 0;
    let sm = 0;
    for (let b = 0; b < NB; b++) {
      const L = Math.log1p(band[b]);
      const d = L - prev[b];
      prev[b] = L;
      if (f > 0 && d > 0) {
        s += d;
        const hz = bandHz(b);
        if (hz <= 150) sl += d;
        if (hz <= 500) sm += d;
      }
    }
    flux[f] = s;
    low[f] = sl;
    lowMid[f] = sm;
  }

  // Adaptive threshold: subtract a ±0.25 s moving average, rectify, normalise.
  const fps = sr / H;
  const w = Math.max(1, Math.round(fps * 0.25));
  const pre = new Float64Array(nFrames + 1);
  for (let i = 0; i < nFrames; i++) pre[i + 1] = pre[i] + flux[i];
  const onset = new Float32Array(nFrames);
  let sq = 0;
  for (let i = 0; i < nFrames; i++) {
    const a = Math.max(0, i - w);
    const b = Math.min(nFrames, i + w + 1);
    const v = Math.max(0, flux[i] - (pre[b] - pre[a]) / (b - a));
    onset[i] = v;
    sq += v * v;
  }
  const sd = Math.sqrt(sq / Math.max(1, nFrames)) || 1;
  for (let i = 0; i < nFrames; i++) onset[i] /= sd;
  return { onset, low, lowMid };
}

function makeFFT(n: number) {
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n);
    sin[k] = Math.sin((2 * Math.PI * k) / n);
  }
  return (re: Float64Array, im: Float64Array) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const l = i + j + half;
          const tr = re[l] * cos[k] + im[l] * sin[k];
          const ti = im[l] * cos[k] - re[l] * sin[k];
          re[l] = re[i + j] - tr;
          im[l] = im[i + j] - ti;
          re[i + j] += tr;
          im[i + j] += ti;
        }
      }
    }
  };
}

/* ---------------------------------------------------------------- tempo */

function estimateLag(
  on: Float32Array, a: number, b: number,
  minLag: number, maxLag: number,
  centerBpm: number, sigma: number, fps: number,
): number {
  const maxL = Math.min(2 * maxLag + 1, b - a - 2);
  if (maxL <= minLag) return (60 * fps) / centerBpm;
  const ac = new Float64Array(maxL + 1);
  for (let lag = minLag; lag <= maxL; lag++) {
    let s = 0;
    for (let i = a; i + lag < b; i++) s += on[i] * on[i + lag];
    ac[lag] = s / (b - a - lag);
  }
  const score = (lag: number) => {
    if (lag < minLag || lag > maxLag) return -Infinity;
    const z = Math.log2((60 * fps) / lag / centerBpm) / sigma;
    const harmonic = 2 * lag <= maxL ? ac[2 * lag] : 0;
    return (ac[lag] + 0.5 * harmonic) * Math.exp(-0.5 * z * z);
  };
  let best = minLag;
  let bs = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const v = score(lag);
    if (v > bs) { bs = v; best = lag; }
  }
  const y0 = score(best - 1);
  const y2 = score(best + 1);
  if (Number.isFinite(y0) && Number.isFinite(y2)) {
    const d = y0 - 2 * bs + y2;
    if (d < 0) return best + (0.5 * (y0 - y2)) / d;
  }
  return best;
}

function localPeriods(on: Float32Array, fps: number, minLag: number, maxLag: number, globalLag: number) {
  const n = on.length;
  const out = new Float64Array(n);
  const W = Math.round(fps * 8);
  const step = Math.round(fps * 2);
  if (n < W * 1.5) return out.fill(globalLag);

  const lo = Math.max(minLag, Math.floor(globalLag / 1.4));
  const hi = Math.min(maxLag, Math.ceil(globalLag * 1.4));
  const gBpm = (60 * fps) / globalLag;
  const centers: number[] = [];
  const lags: number[] = [];
  for (let a = 0; ; a += step) {
    let b = a + W;
    let s = a;
    if (b > n) { b = n; s = Math.max(0, n - W); }
    lags.push(estimateLag(on, s, b, lo, hi, gBpm, 0.4, fps));
    centers.push((s + b) / 2);
    if (b >= n) break;
  }
  const sm = medianFilter(lags, 5);
  let j = 0;
  for (let t = 0; t < n; t++) {
    if (t <= centers[0]) { out[t] = sm[0]; continue; }
    if (t >= centers[centers.length - 1]) { out[t] = sm[sm.length - 1]; continue; }
    while (centers[j + 1] < t) j++;
    const u = (t - centers[j]) / (centers[j + 1] - centers[j]);
    out[t] = sm[j] + (sm[j + 1] - sm[j]) * u;
  }
  return out;
}

function trackBeats(on: Float32Array, period: Float64Array, tightness: number): number[] {
  const n = on.length;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    const P = period[t];
    const lo = Math.max(0, Math.round(t - 2 * P));
    const hi = Math.round(t - P / 2);
    let best = -Infinity;
    let arg = -1;
    for (let tau = lo; tau <= hi; tau++) {
      const r = Math.log((t - tau) / P);
      const v = score[tau] - tightness * r * r;
      if (v > best) { best = v; arg = tau; }
    }
    if (arg >= 0 && best > 0) {
      score[t] = on[t] + best;
      back[t] = arg;
    } else {
      score[t] = on[t];
    }
  }
  const tail = Math.max(0, n - Math.round(period[n - 1] * 1.5));
  let end = n - 1;
  for (let t = tail; t < n; t++) if (score[t] > score[end]) end = t;
  const out: number[] = [];
  for (let t = end; t >= 0; t = back[t]) out.push(t);
  return out.reverse();
}

function refinePeak(on: Float32Array, frame: number): number {
  const n = on.length;
  let f = Math.round(frame);
  if (f + 1 < n && on[f + 1] > on[f]) f++;
  else if (f > 0 && on[f - 1] > on[f]) f--;
  if (f <= 0 || f >= n - 1) return f;
  const y0 = on[f - 1], y1 = on[f], y2 = on[f + 1];
  const d = y0 - 2 * y1 + y2;
  if (d >= 0) return f;
  return f + Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / d));
}

/**
 * The tracker can lock onto off-beats (e.g. busy hi-hats). Kick and snare
 * carry most low/mid energy and sit on the beat, so if the midpoints between
 * beats are clearly stronger there, shift the whole train by half a beat.
 */
function fixHalfBeatPhase(frames: number[], lowMid: Float32Array): number[] {
  if (frames.length < 8) return frames;
  const at = (f: number) => {
    const c = Math.round(f);
    let v = 0;
    for (let d = -1; d <= 1; d++) {
      const j = c + d;
      if (j >= 0 && j < lowMid.length) v = Math.max(v, lowMid[j]);
    }
    return v;
  };
  let on = 0;
  let off = 0;
  const mids: number[] = [];
  for (let i = 0; i < frames.length - 1; i++) {
    const m = (frames[i] + frames[i + 1]) / 2;
    mids.push(m);
    on += at(frames[i]);
    off += at(m);
  }
  if (off <= on * 1.25) return frames;
  const last = frames[frames.length - 1] + (frames[frames.length - 1] - frames[frames.length - 2]) / 2;
  if (last < lowMid.length) mids.push(last);
  const first = frames[0] - (frames[1] - frames[0]) / 2;
  return first >= 0 ? [first, ...mids] : mids;
}

/* ------------------------------------------------------------- segments */

function segmentBeats(beats: number[]): number[] {
  const m = beats.length;
  if (m < 24) return [0, m - 1];
  const sm = medianFilter(diffs(beats), 9);
  const bounds = [0];
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < sm.length; i++) {
    if (cnt >= 8) {
      const mean = sum / cnt;
      const dev = (v: number) => Math.abs(v - mean) / mean;
      if (dev(sm[i]) > 0.04 && sm.length - i >= 8) {
        let persist = true;
        for (let j = 1; j <= 6 && i + j < sm.length; j++) {
          if (dev(sm[i + j]) <= 0.04) { persist = false; break; }
        }
        if (persist) { bounds.push(i); sum = 0; cnt = 0; }
      }
    }
    sum += sm[i];
    cnt++;
  }
  bounds.push(m - 1);
  return bounds;
}

function regularize(beats: number[], bounds: number[]): number[] {
  const out = beats.slice();
  for (let k = 0; k < bounds.length - 1; k++) {
    const i0 = bounds[k];
    const i1 = bounds[k + 1];
    const cnt = i1 - i0 + 1;
    if (cnt < 8) continue;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = i0; i <= i1; i++) {
      const xi = i - i0;
      sx += xi; sy += beats[i]; sxx += xi * xi; sxy += xi * beats[i];
    }
    const slope = (cnt * sxy - sx * sy) / (cnt * sxx - sx * sx);
    const icpt = (sy - slope * sx) / cnt;
    let res = 0;
    for (let i = i0; i <= i1; i++) {
      const e = beats[i] - (icpt + slope * (i - i0));
      res += e * e;
    }
    if (Math.sqrt(res / cnt) < 0.02) {
      for (let i = i0; i <= i1; i++) out[i] = icpt + slope * (i - i0);
    }
  }
  return out;
}

function buildSegments(beats: number[], bounds: number[], duration: number): TempoSegment[] {
  const raw: (TempoSegment & { n: number })[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const i0 = bounds[k];
    const i1 = bounds[k + 1];
    raw.push({
      start: k === 0 ? 0 : beats[i0],
      end: k === bounds.length - 2 ? duration : beats[i1],
      bpm: 60 / median(diffs(beats.slice(i0, i1 + 1))),
      n: i1 - i0,
    });
  }
  const merged: typeof raw = [];
  for (const s of raw) {
    const p = merged[merged.length - 1];
    if (p && Math.abs(p.bpm - s.bpm) / p.bpm < 0.015) {
      p.bpm = (p.bpm * p.n + s.bpm * s.n) / (p.n + s.n);
      p.n += s.n;
      p.end = s.end;
    } else merged.push({ ...s });
  }
  return merged.map(({ start, end, bpm }) => ({ start, end, bpm: round1(bpm) }));
}

function findDownbeat(beats: number[], low: Float32Array, sr: number): number {
  const acc = [0, 0, 0, 0];
  for (let i = 0; i < beats.length; i++) {
    const f = Math.round(((beats[i] + LEAD) * sr - N / 2) / H);
    let v = 0;
    for (let d = -1; d <= 1; d++) {
      const j = f + d;
      if (j >= 0 && j < low.length) v = Math.max(v, low[j]);
    }
    acc[i % 4] += v;
  }
  return acc.indexOf(Math.max(...acc));
}

/* -------------------------------------------------------------- helpers */

function diffs(a: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < a.length; i++) out.push(a[i] - a[i - 1]);
  return out;
}

function median(a: number[]): number {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function medianFilter(a: number[], size: number): number[] {
  const h = size >> 1;
  return a.map((_, i) => median(a.slice(Math.max(0, i - h), Math.min(a.length, i + h + 1))));
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}
