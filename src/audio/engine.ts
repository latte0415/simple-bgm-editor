import type { Clip, Id, Range, Source, Track } from '../state/types';
import { arrangementEnd, clipEnd, effectiveFades, fadeGain, type Fades } from '../state/edit';
import { dbToGain } from '../lib/format';

export interface Project {
  clips: Clip[];
  tracks: Track[];
  sources: Record<Id, Source>;
}

/** Fade applied where a playback window cuts into the middle of a clip (loop seams, seeking). */
const SEAM = 0.004;

export function trackGain(t: Track, tracks: Track[]): number {
  const anySolo = tracks.some((x) => x.solo);
  if (t.muted || (anySolo && !t.solo)) return 0;
  return dbToGain(t.volumeDb);
}

/**
 * Schedules every clip overlapping timeline window [from, to) so that `from`
 * sounds at context time `when`. Shared by live playback and offline export.
 */
export function scheduleWindow(
  ctx: BaseAudioContext,
  p: Project,
  from: number,
  to: number,
  when: number,
  dest: (trackId: Id) => AudioNode,
  onVoice?: (src: AudioBufferSourceNode, gain: GainNode) => void,
) {
  const byTrack = new Map<Id, Clip[]>();
  for (const c of p.clips) {
    const list = byTrack.get(c.trackId);
    if (list) list.push(c);
    else byTrack.set(c.trackId, [c]);
  }
  for (const c of p.clips) {
    const src = p.sources[c.sourceId];
    if (!src) continue;
    const s = c.start;
    const e = clipEnd(c);
    const p0 = Math.max(s, from);
    const p1 = Math.min(e, to);
    if (p1 - p0 < 1e-4) continue;
    const t0 = when + (p0 - from);
    const node = ctx.createBufferSource();
    node.buffer = src.buffer;
    const g = ctx.createGain();
    node.connect(g).connect(dest(c.trackId));
    const fades = effectiveFades(c, byTrack.get(c.trackId) ?? []);
    scheduleEnvelope(g.gain, c, fades, p0, p1, t0, p0 > s + 1e-6, p1 < e - 1e-6);
    node.start(t0, c.offset + (p0 - s), p1 - p0);
    onVoice?.(node, g);
  }
}

function scheduleEnvelope(
  param: AudioParam, c: Clip, f: Fades,
  p0: number, p1: number, t0: number,
  seamIn: boolean, seamOut: boolean,
) {
  const gain = dbToGain(c.gainDb);
  const s = c.start;
  const e = clipEnd(c);
  const seam = Math.min(SEAM, (p1 - p0) / 2);
  const env = (t: number) => {
    let v = gain * fadeGain(c, f, t);
    if (seamIn) v *= Math.min(1, (t - p0) / seam);
    if (seamOut) v *= Math.min(1, (p1 - t) / seam);
    return Math.max(0, v);
  };
  const marks = [p0, p1, s + f.fi, e - f.fo];
  if (seamIn) marks.push(p0 + seam);
  if (seamOut) marks.push(p1 - seam);
  const pts = [...new Set(marks.filter((t) => t >= p0 && t <= p1))].sort((a, b) => a - b);

  param.setValueAtTime(env(p0), t0);
  for (let i = 0; i < pts.length - 1; i++) {
    const u = pts[i];
    const v = pts[i + 1];
    if (v - u < 1e-5) continue;
    const flat =
      u >= s + f.fi - 1e-9 && v <= e - f.fo + 1e-9 &&
      !(seamIn && u < p0 + seam - 1e-9) && !(seamOut && v > p1 - seam + 1e-9);
    if (flat) {
      param.setValueAtTime(env((u + v) / 2), t0 + (u - p0));
      continue;
    }
    const n = Math.max(16, Math.min(2048, Math.ceil((v - u) * 400)));
    const curve = new Float32Array(n);
    for (let k = 0; k < n; k++) curve[k] = env(u + ((v - u) * k) / (n - 1));
    param.setValueCurveAtTime(curve, t0 + (u - p0), v - u - 1e-5);
  }
}

interface Iteration {
  ctxStart: number;
  from: number;
  to: number;
}

class Engine {
  private c: AudioContext | null = null;
  private master: GainNode | null = null;
  private tracks = new Map<Id, GainNode>();
  private voices = new Set<{ src: AudioBufferSourceNode; gain: GainNode }>();
  private iters: Iteration[] = [];
  private loop: Range | null = null;
  private project: Project | null = null;
  private timer = 0;
  playing = false;
  onEnded: (() => void) | null = null;

  get ctx(): AudioContext {
    if (!this.c) {
      this.c = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.c.createGain();
      this.master.connect(this.c.destination);
    }
    return this.c;
  }

  decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data);
  }

  private trackNode(id: Id): GainNode {
    let n = this.tracks.get(id);
    if (!n) {
      n = this.ctx.createGain();
      n.connect(this.master!);
      this.tracks.set(id, n);
      const t = this.project?.tracks.find((x) => x.id === id);
      if (t && this.project) n.gain.value = trackGain(t, this.project.tracks);
    }
    return n;
  }

  updateTrackGains(tracks: Track[]) {
    if (!this.c) return;
    const now = this.c.currentTime;
    for (const t of tracks) this.trackNode(t.id).gain.setTargetAtTime(trackGain(t, tracks), now, 0.008);
  }

  /** Starts (or restarts) playback at timeline position `from`. Returns false if there's nothing to play. */
  play(from: number, project: Project, loop: Range | null): boolean {
    this.stopVoices();
    this.project = project;
    const ctx = this.ctx;
    void ctx.resume();
    this.updateTrackGains(project.tracks);
    this.loop = loop && loop.end - loop.start > 0.05 ? loop : null;
    let to: number;
    if (this.loop) {
      if (from < this.loop.start || from >= this.loop.end) from = this.loop.start;
      to = this.loop.end;
    } else {
      to = arrangementEnd(project.clips);
      if (from >= to - 0.01) {
        this.stop();
        return false;
      }
    }
    const start = ctx.currentTime + 0.03;
    this.iters = [{ ctxStart: start, from, to }];
    this.schedule(this.iters[0]);
    this.playing = true;
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), 40);
    return true;
  }

  private schedule(it: Iteration) {
    if (!this.project) return;
    scheduleWindow(this.ctx, this.project, it.from, it.to, it.ctxStart, (id) => this.trackNode(id), (src, gain) => {
      const v = { src, gain };
      this.voices.add(v);
      src.onended = () => {
        this.voices.delete(v);
        gain.disconnect();
      };
    });
  }

  private tick() {
    const ctx = this.ctx;
    const last = this.iters[this.iters.length - 1];
    if (!last) return;
    const lastEnd = last.ctxStart + (last.to - last.from);
    if (this.loop) {
      if (lastEnd - ctx.currentTime < 0.4) {
        const it = { ctxStart: lastEnd, from: this.loop.start, to: this.loop.end };
        this.iters.push(it);
        this.schedule(it);
        if (this.iters.length > 4) this.iters.shift();
      }
    } else if (ctx.currentTime >= lastEnd) {
      this.stop();
      this.onEnded?.();
    }
  }

  /** Timeline position currently heard. */
  position(): number {
    if (!this.playing || !this.c) return NaN;
    const lat = (this.c as AudioContext & { outputLatency?: number }).outputLatency || this.c.baseLatency || 0;
    const now = this.c.currentTime - lat;
    let it = this.iters[0];
    for (const x of this.iters) if (x.ctxStart <= now) it = x;
    if (!it) return NaN;
    return Math.min(it.to, it.from + Math.max(0, now - it.ctxStart));
  }

  stop() {
    clearInterval(this.timer);
    this.stopVoices();
    this.iters = [];
    this.playing = false;
  }

  private stopVoices() {
    if (!this.c) return;
    const now = this.c.currentTime;
    for (const v of this.voices) {
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setTargetAtTime(0, now, 0.003);
        v.src.stop(now + 0.02);
      } catch {
        /* already stopped */
      }
    }
    this.voices.clear();
  }
}

export const engine = new Engine();
