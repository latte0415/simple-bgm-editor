import type { Clip, Id } from './types';
import { uid } from '../lib/format';

export const MIN_LEN = 0.01;
/** Minimum fade applied at non-contiguous clip edges to avoid clicks. */
export const DECLICK = 0.003;
const EPS = 1e-6;

export const clipEnd = (c: Clip) => c.start + c.duration;

export function splitClip(c: Clip, t: number): [Clip, Clip] | null {
  if (t <= c.start + MIN_LEN || t >= clipEnd(c) - MIN_LEN) return null;
  const leftDur = t - c.start;
  const rightDur = c.duration - leftDur;
  const left: Clip = { ...c, duration: leftDur, fadeIn: Math.min(c.fadeIn, leftDur), fadeOut: 0 };
  const right: Clip = {
    ...c,
    id: uid('clip'),
    start: t,
    offset: c.offset + leftDur,
    duration: rightDur,
    fadeIn: 0,
    fadeOut: Math.min(c.fadeOut, rightDur),
  };
  return [left, right];
}

/**
 * Removes [a, b) from clips on the given tracks. With `ripple`, later material
 * moves left to close the gap. `joinLength` (ripple only) returns how far the
 * right-hand piece should reach back into removed audio so it overlaps the
 * left piece and the two crossfade with beats still aligned at the cut.
 */
export function removeRange(
  clips: Clip[],
  trackIds: Set<Id>,
  a: number,
  b: number,
  ripple: boolean,
  joinLength?: (right: Clip) => number,
): Clip[] {
  const len = b - a;
  const out: Clip[] = [];
  const joinCandidates: Clip[] = [];
  for (const c of clips) {
    if (!trackIds.has(c.trackId)) {
      out.push(c);
      continue;
    }
    const s = c.start;
    const e = clipEnd(c);
    if (e <= a + EPS) {
      out.push(c);
      continue;
    }
    if (s >= b - EPS) {
      const moved = ripple ? { ...c, start: s - len } : c;
      out.push(moved);
      if (ripple && Math.abs(moved.start - a) < EPS) joinCandidates.push(moved);
      continue;
    }
    if (a - s >= MIN_LEN) {
      out.push({ ...c, duration: a - s, fadeOut: 0, fadeIn: Math.min(c.fadeIn, a - s) });
    }
    if (e - b >= MIN_LEN) {
      const right: Clip = {
        ...c,
        id: uid('clip'),
        start: ripple ? a : b,
        offset: c.offset + (b - s),
        duration: e - b,
        fadeIn: 0,
        fadeOut: Math.min(c.fadeOut, e - b),
      };
      out.push(right);
      if (ripple) joinCandidates.push(right);
    }
  }
  if (ripple && joinLength) {
    for (const r of joinCandidates) {
      const left = out.find((c) => c.trackId === r.trackId && c.id !== r.id && Math.abs(clipEnd(c) - a) < EPS);
      if (!left) continue;
      const x = Math.min(joinLength(r), r.offset, left.duration * 0.5, r.duration * 0.5);
      if (x <= 0.001) continue;
      const i = out.indexOf(r);
      out[i] = { ...r, start: r.start - x, offset: r.offset - x, duration: r.duration + x };
    }
  }
  return out;
}

export interface Fades {
  fi: number;
  fo: number;
  /** Portion of fi/fo caused by an overlapping neighbour (crossfade). */
  xfIn: number;
  xfOut: number;
}

/** Fades actually applied: manual fades, auto crossfades with overlapping neighbours, and declick. */
export function effectiveFades(c: Clip, trackClips: Clip[]): Fades {
  const e = clipEnd(c);
  let xfIn = 0;
  let xfOut = 0;
  let contPrev = false;
  let contNext = false;
  for (const o of trackClips) {
    if (o.id === c.id) continue;
    const oe = clipEnd(o);
    if (o.start < c.start - EPS && oe > c.start + EPS && oe < e - EPS) xfIn = Math.max(xfIn, oe - c.start);
    if (o.start > c.start + EPS && o.start < e - EPS && oe > e + EPS) xfOut = Math.max(xfOut, e - o.start);
    if (o.sourceId === c.sourceId) {
      if (Math.abs(oe - c.start) < 1e-4 && Math.abs(o.offset + o.duration - c.offset) < 1e-4) contPrev = true;
      if (Math.abs(o.start - e) < 1e-4 && Math.abs(c.offset + c.duration - o.offset) < 1e-4) contNext = true;
    }
  }
  let fi = Math.max(c.fadeIn, xfIn);
  let fo = Math.max(c.fadeOut, xfOut);
  if (!contPrev) fi = Math.max(fi, DECLICK);
  if (!contNext) fo = Math.max(fo, DECLICK);
  if (fi + fo > c.duration) {
    const k = c.duration / (fi + fo);
    fi *= k;
    fo *= k;
  }
  return { fi, fo, xfIn, xfOut };
}

/** Equal-power gain (without clip gain) at timeline time t. */
export function fadeGain(c: Clip, f: Fades, t: number): number {
  let g = 1;
  const x = t - c.start;
  if (f.fi > 0 && x < f.fi) g *= Math.sin((Math.PI / 2) * Math.max(0, x / f.fi));
  const y = clipEnd(c) - t;
  if (f.fo > 0 && y < f.fo) g *= Math.sin((Math.PI / 2) * Math.max(0, y / f.fo));
  return g;
}

export function arrangementEnd(clips: Clip[]): number {
  let e = 0;
  for (const c of clips) e = Math.max(e, clipEnd(c));
  return e;
}
