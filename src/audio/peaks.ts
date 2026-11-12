import type { Peaks } from '../state/types';

const BASE = 64;

export function computePeaks(buf: AudioBuffer): Peaks {
  const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const n = buf.length;
  const nb = Math.ceil(n / BASE);
  const min = new Float32Array(nb);
  const max = new Float32Array(nb);
  const ms = new Float32Array(nb);
  const k = 1 / channels.length;
  for (let b = 0; b < nb; b++) {
    let lo = 1;
    let hi = -1;
    let sq = 0;
    const end = Math.min(n, (b + 1) * BASE);
    for (let i = b * BASE; i < end; i++) {
      let v = 0;
      for (const ch of channels) v += ch[i];
      v *= k;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sq += v * v;
    }
    min[b] = lo;
    max[b] = hi;
    ms[b] = sq / Math.max(1, end - b * BASE);
  }
  const levels = [{ bucket: BASE, min, max, ms }];
  while (levels[levels.length - 1].min.length > 64) {
    const p = levels[levels.length - 1];
    const len = Math.ceil(p.min.length / 4);
    const mn = new Float32Array(len);
    const mx = new Float32Array(len);
    const m2 = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      let lo = 1;
      let hi = -1;
      let sq = 0;
      const j1 = Math.min(p.min.length, i * 4 + 4);
      for (let j = i * 4; j < j1; j++) {
        if (p.min[j] < lo) lo = p.min[j];
        if (p.max[j] > hi) hi = p.max[j];
        sq += p.ms[j];
      }
      mn[i] = lo;
      mx[i] = hi;
      m2[i] = sq / (j1 - i * 4);
    }
    levels.push({ bucket: p.bucket * 4, min: mn, max: mx, ms: m2 });
  }
  return { channels, length: n, sampleRate: buf.sampleRate, levels };
}

/** Min, max and RMS of the mono mix over sample range [a, b). Writes into `out`. */
export function rangeMinMax(p: Peaks, a: number, b: number, out: Float32Array) {
  const s0 = Math.max(0, Math.floor(a));
  const s1 = Math.min(p.length, Math.ceil(b));
  if (s1 <= s0) {
    if (s0 < p.length && s0 >= 0) {
      let v = 0;
      for (const ch of p.channels) v += ch[s0];
      v /= p.channels.length;
      out[0] = Math.min(0, v);
      out[1] = Math.max(0, v);
      out[2] = Math.abs(v);
    } else {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
    }
    return;
  }
  const span = s1 - s0;
  let lo = 1;
  let hi = -1;
  let sq = 0;
  let cnt = 0;
  if (span < BASE) {
    const k = 1 / p.channels.length;
    for (let i = s0; i < s1; i++) {
      let v = 0;
      for (const ch of p.channels) v += ch[i];
      v *= k;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sq += v * v;
    }
    cnt = s1 - s0;
  } else {
    let lv = p.levels[0];
    for (const l of p.levels) if (l.bucket <= span) lv = l;
    const i0 = Math.floor(s0 / lv.bucket);
    const i1 = Math.max(i0 + 1, Math.ceil(s1 / lv.bucket));
    for (let i = i0; i < Math.min(i1, lv.min.length); i++) {
      if (lv.min[i] < lo) lo = lv.min[i];
      if (lv.max[i] > hi) hi = lv.max[i];
      sq += lv.ms[i];
      cnt++;
    }
  }
  out[0] = lo > hi ? 0 : lo;
  out[1] = lo > hi ? 0 : hi;
  out[2] = cnt ? Math.sqrt(sq / cnt) : 0;
}
