/**
 * Canvas arrangement view: ruler, lanes, clips, grid, selections.
 * Imperative on purpose: it redraws on store changes without React renders.
 *
 * Mouse model (after Ableton's arrangement view):
 *   clip title bar  drag = move (also across tracks), shift-click = add to selection
 *   clip body       click = set insert marker, drag = time selection
 *   clip edges      drag = trim
 *   fade handles    drag = fade length
 *   ruler           click/drag = set position
 *   ⌥ while dragging = no snapping
 */
import { commit, get, pushHistory, set, setScroll, useEditor, zoomAt } from '../state/store';
import { clipEnd, DECLICK, effectiveFades, fadeGain, MIN_LEN, type Fades } from '../state/edit';
import { displayDiv, gridLines, nearestGrid, resolveDiv } from '../lib/grid';
import { rangeMinMax } from '../audio/peaks';
import { position, seek } from '../audio/transport';
import { clamp, dbToGain, fmtShort } from '../lib/format';
import type { Analysis, Clip } from '../state/types';
import { HEAD_H, LANE_H, RULER_H } from './layout';

type Drag =
  | { kind: 'seek' }
  | { kind: 'move'; x0: number; y0: number; anchor: string; orig: Map<string, { start: number; lane: number }>; moved: boolean }
  | { kind: 'trim'; id: string; side: 'l' | 'r'; orig: Clip; moved: boolean }
  | { kind: 'fade'; id: string; side: 'in' | 'out'; moved: boolean }
  | { kind: 'select'; x0: number; lane0: number; t0: number; moved: boolean; clipId: string | null };

type Hit =
  | { type: 'ruler' }
  | { type: 'fade'; clip: Clip; side: 'in' | 'out'; lane: number }
  | { type: 'trim'; clip: Clip; side: 'l' | 'r'; lane: number }
  | { type: 'head'; clip: Clip; lane: number }
  | { type: 'body'; clip: Clip; lane: number }
  | { type: 'lane'; lane: number }
  | { type: 'none' };

interface Colors {
  bg: string; surface: string; lane: string; ink: string; ink2: string; ink3: string;
  line: string; lineSoft: string; lineFaint: string; accent: string; accentSoft: string;
  head: string; wave: string; wavePeak: string; mono: string;
}

function readColors(): Colors {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    bg: v('--bg'), surface: v('--surface'), lane: v('--lane'), ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'),
    line: v('--line'), lineSoft: v('--line-soft'), lineFaint: v('--line-faint'), accent: v('--accent'),
    accentSoft: v('--accent-soft'), head: v('--clip-head'), wave: v('--wave'), wavePeak: v('--wave-peak'), mono: v('--mono'),
  };
}

const SNAP_PX = 10;
const EDGE_PX = 5;
const HANDLE = 7;

export class ArrangementView {
  private g: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private raf = 0;
  private tickRaf = 0;
  private drag: Drag | null = null;
  private hoverId: string | null = null;
  private col: Colors;
  private unsub: () => void;
  private ro: ResizeObserver;
  private dark: MediaQueryList;
  private mm = new Float32Array(3);

  constructor(
    private wrap: HTMLElement,
    private canvas: HTMLCanvasElement,
    private head: HTMLElement,
  ) {
    this.g = canvas.getContext('2d')!;
    this.col = readColors();
    this.dark = matchMedia('(prefers-color-scheme: dark)');
    this.dark.addEventListener('change', this.onTheme);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(wrap);
    this.unsub = useEditor.subscribe(() => this.request());
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('dblclick', this.onDbl);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.tick();
  }

  destroy() {
    this.ro.disconnect();
    this.unsub();
    this.dark.removeEventListener('change', this.onTheme);
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.tickRaf);
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('pointerleave', this.onLeave);
    c.removeEventListener('dblclick', this.onDbl);
    c.removeEventListener('wheel', this.onWheel);
  }

  private onTheme = () => {
    this.col = readColors();
    this.request();
  };

  private resize() {
    const r = this.wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    set({ viewWidth: r.width });
    this.draw();
  }

  private request() {
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  /* ----------------------------------------------------------- geometry */

  private xAt(t: number) {
    const s = get();
    return (t - s.scrollX) * s.pxPerSec;
  }
  private timeAt(x: number) {
    const s = get();
    return s.scrollX + x / s.pxPerSec;
  }
  private laneAt(y: number) {
    return Math.floor((y - RULER_H) / LANE_H);
  }
  private laneTop(i: number) {
    return RULER_H + i * LANE_H;
  }
  private local(e: PointerEvent | MouseEvent | WheelEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private analysis(c: Clip): Analysis | null {
    const an = get().sources[c.sourceId]?.analysis;
    return an && an.beats.length > 1 ? an : null;
  }
  private pxPerBeat(an: Analysis) {
    return an.bpm > 0 ? (60 / an.bpm) * get().pxPerSec : 0;
  }
  private laneClips(lane: number): Clip[] {
    const s = get();
    const t = s.tracks[lane];
    return t ? s.clips.filter((c) => c.trackId === t.id) : [];
  }
  private clipAt(lane: number, t: number): Clip | null {
    const sel = new Set(get().selected);
    const list = this.laneClips(lane).filter((c) => t >= c.start && t <= clipEnd(c));
    return list.find((c) => sel.has(c.id)) ?? list[list.length - 1] ?? null;
  }

  /* ------------------------------------------------------------ snapping */

  private gridSnapInClip(c: Clip, t: number): number | null {
    const an = this.analysis(c);
    if (!an) return null;
    const div = resolveDiv(get().grid, this.pxPerBeat(an));
    const g = nearestGrid(an, c.offset + (t - c.start), div);
    return g == null ? null : c.start + (g - c.offset);
  }

  /** Snap a time on `lane`: grid of the clip under it (or on another lane), then nearby clip edges. */
  private snapTime(t: number, lane: number, exclude?: Set<string>, ref?: Clip | null): number {
    const s = get();
    if (!s.snap) return t;
    const thr = SNAP_PX / s.pxPerSec;
    let best = t;
    let bestD = Infinity;
    let r = ref ?? this.clipAt(lane, t);
    if (!r) {
      let dist = Infinity;
      s.tracks.forEach((_, i) => {
        const c = this.clipAt(i, t);
        if (c && Math.abs(i - lane) < dist) { dist = Math.abs(i - lane); r = c; }
      });
    }
    if (r) {
      const g = this.gridSnapInClip(r, t);
      if (g != null) { best = g; bestD = Math.abs(g - t); }
    }
    const cands = [0];
    for (const c of s.clips) if (!exclude?.has(c.id)) cands.push(c.start, clipEnd(c));
    for (const e of cands) {
      const d = Math.abs(e - t);
      if (d < thr && d < bestD) { best = e; bestD = d; }
    }
    return best;
  }

  /** Magnetic move: align any grid line / edge of the moving clip with any grid line / edge of other clips. */
  private snapMove(c: Clip, start: number, moving: Set<string>): number {
    const s = get();
    const pps = s.pxPerSec;
    const thr = SNAP_PX / pps;
    const v0 = s.scrollX - thr;
    const v1 = s.scrollX + this.w / pps + thr;
    const targets: number[] = [0, s.playhead];
    for (const o of s.clips) {
      if (moving.has(o.id)) continue;
      targets.push(o.start, clipEnd(o));
      const an = this.analysis(o);
      if (!an) continue;
      const div = resolveDiv(s.grid, this.pxPerBeat(an));
      const a = o.offset + Math.max(0, v0 - o.start);
      const b = o.offset + Math.min(o.duration, v1 - o.start);
      if (b > a) for (const l of gridLines(an, a, b, div)) targets.push(o.start + l.t - o.offset);
    }
    targets.sort((x, y) => x - y);
    const anchors = [0, c.duration];
    const an = this.analysis(c);
    if (an) {
      const div = resolveDiv(s.grid, this.pxPerBeat(an));
      const a = c.offset + Math.max(0, v0 - start);
      const b = c.offset + Math.min(c.duration, v1 - start);
      if (b > a) for (const l of gridLines(an, a, b, div)) anchors.push(l.t - c.offset);
    }
    let best = Infinity;
    for (const a of anchors) {
      const p = start + a;
      let lo = 0;
      let hi = targets.length - 1;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (targets[m] <= p) lo = m;
        else hi = m;
      }
      for (const tg of [targets[lo], targets[hi]]) {
        const d = tg - p;
        if (Math.abs(d) < Math.abs(best)) best = d;
      }
    }
    return Math.abs(best) <= thr ? start + best : start;
  }

  /* ------------------------------------------------------------ hit test */

  private hit(x: number, y: number): Hit {
    const s = get();
    if (y < RULER_H) return { type: 'ruler' };
    const lane = this.laneAt(y);
    if (lane < 0 || lane >= s.tracks.length) return { type: 'none' };
    const top = this.laneTop(lane);
    const y0 = top + 2;
    const yHead = y0 + HEAD_H;
    const sel = new Set(s.selected);
    const list = this.laneClips(lane);
    const ordered = [...list.filter((c) => sel.has(c.id)).reverse(), ...list.filter((c) => !sel.has(c.id)).reverse()];
    const pps = s.pxPerSec;
    for (const c of ordered) {
      const x0 = this.xAt(c.start);
      const x1 = this.xAt(clipEnd(c));
      if (x < x0 - EDGE_PX || x > x1 + EDGE_PX) continue;
      if (Math.abs(y - yHead) <= HANDLE) {
        const fi = x0 + c.fadeIn * pps;
        const fo = x1 - c.fadeOut * pps;
        if (Math.abs(x - fi) <= HANDLE && fi < fo + 1) return { type: 'fade', clip: c, side: 'in', lane };
        if (Math.abs(x - fo) <= HANDLE) return { type: 'fade', clip: c, side: 'out', lane };
      }
      if (y > yHead && x - x0 < EDGE_PX && x0 - x < EDGE_PX) return { type: 'trim', clip: c, side: 'l', lane };
      if (y > yHead && x1 - x < EDGE_PX && x - x1 < EDGE_PX) return { type: 'trim', clip: c, side: 'r', lane };
      if (x >= x0 && x <= x1) return y <= yHead ? { type: 'head', clip: c, lane } : { type: 'body', clip: c, lane };
    }
    return { type: 'lane', lane };
  }

  /* ------------------------------------------------------------- pointer */

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const { x, y } = this.local(e);
    const h = this.hit(x, y);
    const s = get();
    if (h.type === 'none') {
      set({ selected: [], timeSel: null });
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    const t = this.timeAt(x);
    switch (h.type) {
      case 'ruler':
        this.drag = { kind: 'seek' };
        set({ playhead: Math.max(0, e.altKey ? t : this.snapTime(t, 0)) });
        break;
      case 'fade':
        set({ selected: [h.clip.id], timeSel: null });
        this.drag = { kind: 'fade', id: h.clip.id, side: h.side, moved: false };
        break;
      case 'trim':
        set({ selected: [h.clip.id], timeSel: null });
        this.drag = { kind: 'trim', id: h.clip.id, side: h.side, orig: { ...h.clip }, moved: false };
        break;
      case 'head': {
        let selected = s.selected;
        if (e.shiftKey) {
          selected = selected.includes(h.clip.id) ? selected.filter((id) => id !== h.clip.id) : [...selected, h.clip.id];
        } else if (!selected.includes(h.clip.id)) {
          selected = [h.clip.id];
        }
        set({ selected, timeSel: null });
        const lanes = new Map(s.tracks.map((tr, i) => [tr.id, i]));
        const orig = new Map(
          s.clips.filter((c) => selected.includes(c.id)).map((c) => [c.id, { start: c.start, lane: lanes.get(c.trackId) ?? 0 }]),
        );
        if (orig.has(h.clip.id)) this.drag = { kind: 'move', x0: x, y0: y, anchor: h.clip.id, orig, moved: false };
        break;
      }
      case 'body':
      case 'lane': {
        const t0 = e.altKey ? t : this.snapTime(t, h.lane);
        this.drag = { kind: 'select', x0: x, lane0: h.lane, t0: Math.max(0, t0), moved: false, clipId: h.type === 'body' ? h.clip.id : null };
        break;
      }
    }
    this.updateCursor(h);
  };

  private onMove = (e: PointerEvent) => {
    const { x, y } = this.local(e);
    const d = this.drag;
    if (!d) {
      const h = this.hit(x, y);
      const id = 'clip' in h ? h.clip.id : null;
      if (id !== this.hoverId) { this.hoverId = id; this.request(); }
      this.updateCursor(h);
      return;
    }
    const s = get();
    const free = e.altKey;
    const t = this.timeAt(x);
    switch (d.kind) {
      case 'seek':
        set({ playhead: Math.max(0, free ? t : this.snapTime(t, 0)) });
        break;
      case 'move': {
        if (!d.moved && Math.abs(x - d.x0) < 3 && Math.abs(y - d.y0) < 3) return;
        if (!d.moved) { pushHistory(); d.moved = true; }
        const lanes = [...d.orig.values()].map((o) => o.lane);
        const ld = clamp(Math.round((y - d.y0) / LANE_H), -Math.min(...lanes), s.tracks.length - 1 - Math.max(...lanes));
        const a = d.orig.get(d.anchor)!;
        let start = a.start + (x - d.x0) / s.pxPerSec;
        const anchorClip = s.clips.find((c) => c.id === d.anchor);
        if (anchorClip && s.snap && !free) start = this.snapMove(anchorClip, start, new Set(d.orig.keys()));
        let dt = start - a.start;
        const minStart = Math.min(...[...d.orig.values()].map((o) => o.start));
        if (minStart + dt < 0) dt = -minStart;
        set({
          clips: s.clips.map((c) => {
            const o = d.orig.get(c.id);
            return o ? { ...c, start: o.start + dt, trackId: s.tracks[o.lane + ld].id } : c;
          }),
        });
        break;
      }
      case 'trim': {
        if (!d.moved) { pushHistory(); d.moved = true; }
        const o = d.orig;
        let tt = t;
        if (s.snap && !free) {
          const g = this.gridSnapInClip(o, t);
          tt = this.snapTime(t, 0, new Set([o.id]), null);
          if (g != null && Math.abs(g - t) <= Math.abs(tt - t)) tt = g;
          else if (g != null && Math.abs(tt - t) > SNAP_PX / s.pxPerSec) tt = g;
        }
        const srcDur = s.sources[o.sourceId]?.buffer.duration ?? o.offset + o.duration;
        let patch: Partial<Clip>;
        if (d.side === 'l') {
          const v = clamp(tt, Math.max(0, o.start - o.offset), clipEnd(o) - MIN_LEN);
          const dur = clipEnd(o) - v;
          patch = { start: v, offset: o.offset + (v - o.start), duration: dur, fadeIn: Math.min(o.fadeIn, dur), fadeOut: Math.min(o.fadeOut, dur) };
        } else {
          const v = clamp(tt, o.start + MIN_LEN, o.start + (srcDur - o.offset));
          const dur = v - o.start;
          patch = { duration: dur, fadeIn: Math.min(o.fadeIn, dur), fadeOut: Math.min(o.fadeOut, dur) };
        }
        set({ clips: s.clips.map((c) => (c.id === d.id ? { ...c, ...patch } : c)) });
        break;
      }
      case 'fade': {
        const c = s.clips.find((k) => k.id === d.id);
        if (!c) return;
        if (!d.moved) { pushHistory(); d.moved = true; }
        let tt = t;
        if (s.snap && !free) tt = this.gridSnapInClip(c, t) ?? t;
        const patch = d.side === 'in'
          ? { fadeIn: clamp(tt - c.start, 0, c.duration - c.fadeOut) }
          : { fadeOut: clamp(clipEnd(c) - tt, 0, c.duration - c.fadeIn) };
        set({ clips: s.clips.map((k) => (k.id === d.id ? { ...k, ...patch } : k)) });
        break;
      }
      case 'select': {
        if (!d.moved && Math.abs(x - d.x0) < 3) return;
        d.moved = true;
        const lane = clamp(this.laneAt(y), 0, s.tracks.length - 1);
        const t1 = Math.max(0, free ? t : this.snapTime(t, lane));
        const l0 = Math.min(d.lane0, lane);
        const l1 = Math.max(d.lane0, lane);
        set({
          timeSel: { start: Math.min(d.t0, t1), end: Math.max(d.t0, t1), trackIds: s.tracks.slice(l0, l1 + 1).map((tr) => tr.id) },
          selected: [],
        });
        break;
      }
    }
  };

  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (!d) return;
    const s = get();
    switch (d.kind) {
      case 'seek':
        seek(s.playhead);
        break;
      case 'move':
      case 'trim':
      case 'fade':
        if (d.moved) commit();
        break;
      case 'select':
        if (!d.moved) {
          seek(d.t0);
          set({
            timeSel: { start: d.t0, end: d.t0, trackIds: [s.tracks[d.lane0].id] },
            selected: d.clipId ? [d.clipId] : [],
          });
        } else if (s.timeSel && !s.playing) {
          set({ playhead: s.timeSel.start });
        }
        break;
    }
    const { x, y } = this.local(e);
    this.updateCursor(this.hit(x, y));
  };

  private onLeave = () => {
    if (!this.drag && this.hoverId) { this.hoverId = null; this.request(); }
  };

  private onDbl = (e: MouseEvent) => {
    const { x, y } = this.local(e);
    const h = this.hit(x, y);
    if (h.type === 'head' || h.type === 'body') {
      set({
        timeSel: { start: h.clip.start, end: clipEnd(h.clip), trackIds: [h.clip.trackId] },
        selected: [h.clip.id],
        playhead: h.clip.start,
      });
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const s = get();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.w : 1;
    if (e.ctrlKey || e.metaKey) {
      const { x } = this.local(e);
      zoomAt(clamp(Math.exp(-e.deltaY * k * 0.01), 0.5, 2), x);
      return;
    }
    const delta = e.shiftKey ? e.deltaY || e.deltaX : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    setScroll(s.scrollX + (delta * k) / s.pxPerSec);
  };

  private updateCursor(h: Hit) {
    const map: Record<Hit['type'], string> = {
      ruler: 'pointer', fade: 'ew-resize', trim: 'col-resize', head: this.drag?.kind === 'move' ? 'grabbing' : 'grab',
      body: 'text', lane: 'text', none: 'default',
    };
    this.canvas.style.cursor = map[h.type];
  }

  /* ---------------------------------------------------------- playhead */

  private tick = () => {
    const s = get();
    if (s.playing) {
      const p = position();
      const x = (p - s.scrollX) * s.pxPerSec;
      if (s.follow && !this.drag && (x > this.w * 0.94 || x < 0)) set({ scrollX: Math.max(0, p - (this.w * 0.06) / s.pxPerSec) });
      const x2 = (p - get().scrollX) * s.pxPerSec;
      this.head.style.display = x2 >= 0 && x2 <= this.w ? 'block' : 'none';
      this.head.style.transform = `translateX(${Math.round(x2)}px)`;
    } else {
      this.head.style.display = 'none';
    }
    this.tickRaf = requestAnimationFrame(this.tick);
  };

  /* --------------------------------------------------------------- draw */

  private draw() {
    const g = this.g;
    const s = get();
    const c = this.col;
    const { w, h } = this;
    if (!w || !h) return;
    g.clearRect(0, 0, w, h);
    g.fillStyle = c.bg;
    g.fillRect(0, 0, w, h);

    const lanesBottom = this.laneTop(s.tracks.length);
    for (let i = 0; i < s.tracks.length; i++) {
      const top = this.laneTop(i);
      g.fillStyle = c.lane;
      g.fillRect(0, top, w, LANE_H);
      g.fillStyle = c.lineSoft;
      g.fillRect(0, top + LANE_H - 1, w, 1);
    }
    this.drawTimeGrid(lanesBottom);
    for (let i = 0; i < s.tracks.length; i++) this.drawLane(i);
    this.drawSelection();
    this.drawRuler();

    // Insert marker
    const px = Math.round(this.xAt(s.playhead));
    if (px >= 0 && px <= w) {
      g.fillStyle = s.playing ? c.ink3 : c.ink;
      g.fillRect(px, RULER_H, 1, Math.max(lanesBottom, h) - RULER_H);
      g.beginPath();
      g.moveTo(px - 4.5, RULER_H - 6);
      g.lineTo(px + 5.5, RULER_H - 6);
      g.lineTo(px + 0.5, RULER_H);
      g.closePath();
      g.fill();
    }

    if (!s.tracks.length) {
      g.fillStyle = c.ink3;
      g.textAlign = 'center';
      g.font = `13px ${getComputedStyle(document.body).fontFamily}`;
      g.fillText('YouTube 링크를 붙여넣거나 오디오 파일을 이곳에 끌어다 놓으세요', w / 2, h / 2 - 8);
      g.font = `11px ${c.mono}`;
      g.fillText('MP3 · WAV · M4A · FLAC · OGG — 최대 5 트랙', w / 2, h / 2 + 14);
      g.textAlign = 'left';
    }
  }

  private rulerSteps() {
    const pps = get().pxPerSec;
    const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const major = steps.find((st) => st * pps >= 76) ?? 600;
    const sub = [10, 5, 2].find((k) => (major * pps) / k >= 7) ?? 1;
    return { major, minor: major / sub, ratio: sub };
  }

  private drawTimeGrid(bottom: number) {
    const g = this.g;
    const s = get();
    const { major } = this.rulerSteps();
    const i0 = Math.floor(s.scrollX / major);
    const i1 = Math.ceil((s.scrollX + this.w / s.pxPerSec) / major);
    g.fillStyle = this.col.lineFaint;
    for (let i = i0; i <= i1; i++) g.fillRect(Math.round(this.xAt(i * major)), RULER_H, 1, bottom - RULER_H);
  }

  private drawRuler() {
    const g = this.g;
    const s = get();
    const c = this.col;
    g.fillStyle = c.bg;
    g.fillRect(0, 0, this.w, RULER_H);

    if (s.loopRegion) {
      const a = this.xAt(s.loopRegion.start);
      const b = this.xAt(s.loopRegion.end);
      g.fillStyle = s.loopOn ? c.accent : c.ink3;
      g.fillRect(Math.round(a), 0, Math.max(1, Math.round(b - a)), 4);
    }

    const { major, minor, ratio } = this.rulerSteps();
    const i0 = Math.floor(s.scrollX / minor);
    const i1 = Math.ceil((s.scrollX + this.w / s.pxPerSec) / minor);
    g.font = `10px ${c.mono}`;
    g.textBaseline = 'alphabetic';
    for (let i = i0; i <= i1; i++) {
      const t = i * minor;
      if (t < 0) continue;
      const x = Math.round(this.xAt(t));
      const isMajor = i % ratio === 0;
      g.fillStyle = isMajor ? c.ink : c.ink3;
      g.fillRect(x, RULER_H - (isMajor ? 9 : 4), 1, isMajor ? 9 : 4);
      if (isMajor) {
        g.fillStyle = c.ink2;
        g.fillText(rulerLabel(t, major), x + 4, 15);
      }
    }
    g.fillStyle = c.line;
    g.fillRect(0, RULER_H - 1, this.w, 1);
  }

  private drawSelection() {
    const s = get();
    const sel = s.timeSel;
    if (!sel || sel.end - sel.start <= 1e-6) return;
    const g = this.g;
    const a = Math.round(this.xAt(sel.start));
    const b = Math.round(this.xAt(sel.end));
    s.tracks.forEach((tr, i) => {
      if (!sel.trackIds.includes(tr.id)) return;
      const top = this.laneTop(i);
      g.fillStyle = this.col.accentSoft;
      g.fillRect(a, top, b - a, LANE_H - 1);
      g.fillStyle = this.col.accent;
      g.fillRect(a, top, 1, LANE_H - 1);
      g.fillRect(b, top, 1, LANE_H - 1);
    });
    g.fillStyle = this.col.accentSoft;
    g.fillRect(a, RULER_H - 9, b - a, 8);
  }

  private drawLane(lane: number) {
    const g = this.g;
    const s = get();
    const c = this.col;
    const clips = this.laneClips(lane).sort((p, q) => p.start - q.start);
    const top = this.laneTop(lane);
    const y0 = top + 2;
    const y1 = top + LANE_H - 3;
    const bodyTop = y0 + HEAD_H;
    const bodyH = y1 - bodyTop;
    const sel = new Set(s.selected);
    const pps = s.pxPerSec;
    const fades = new Map<string, Fades>(clips.map((k) => [k.id, effectiveFades(k, clips)]));

    const visible = clips.filter((k) => this.xAt(clipEnd(k)) >= -1 && this.xAt(k.start) <= this.w + 1);
    const rect = (k: Clip) => {
      const x0 = Math.round(this.xAt(k.start));
      const x1 = Math.round(this.xAt(clipEnd(k)));
      return { x0, x1, cx0: Math.max(-2, x0), cx1: Math.min(this.w + 2, x1) };
    };

    // 1. bodies
    for (const k of visible) {
      const { cx0, cx1 } = rect(k);
      g.fillStyle = c.surface;
      g.fillRect(cx0, y0, cx1 - cx0, y1 - y0);
    }

    // 2. beat grid + waveform
    for (const k of visible) {
      const { x0, x1, cx0, cx1 } = rect(k);
      g.save();
      g.beginPath();
      g.rect(cx0, bodyTop, cx1 - cx0, bodyH);
      g.clip();
      const src = s.sources[k.sourceId];
      if (src) {
        const f = fades.get(k.id)!;
        const gain = dbToGain(k.gainDb);
        const sr = src.peaks.sampleRate;
        const spp = sr / pps;
        const mid = bodyTop + bodyH / 2;
        const amp = bodyH / 2 - 2;
        const px0 = Math.max(0, x0);
        const px1 = Math.min(Math.ceil(this.w), x1);
        const mm = this.mm;
        for (let px = px0; px < px1; px++) {
          const tl = s.scrollX + px / pps;
          const a = (k.offset + (tl - k.start)) * sr;
          rangeMinMax(src.peaks, a, a + spp, mm);
          const e = gain * fadeGain(k, f, tl + 0.5 / pps);
          const top2 = mid - Math.min(1, mm[1] * e) * amp;
          const bot = mid - Math.max(-1, mm[0] * e) * amp;
          g.fillStyle = c.wavePeak;
          g.fillRect(px, top2, 1, Math.max(1, bot - top2));
          if (spp > 8) {
            const r = Math.min(1, mm[2] * e * 1.25) * amp;
            g.fillStyle = c.wave;
            g.fillRect(px, mid - r, 1, Math.max(1, 2 * r));
          }
        }
      }
      // Grid on top of the waveform: beats cut through it, bars are dark rules, subdivisions are ticks.
      const an = this.analysis(k);
      if (an) {
        const div = displayDiv(s.grid, this.pxPerBeat(an));
        const a = k.offset + Math.max(0, s.scrollX - k.start);
        const b = k.offset + Math.min(k.duration, s.scrollX + this.w / pps - k.start);
        for (const l of gridLines(an, a, b, div)) {
          const gx = Math.round(this.xAt(k.start + l.t - k.offset));
          if (l.level === 0) {
            g.fillStyle = c.surface;
            g.fillRect(gx, bodyTop, 1, bodyH);
            g.fillStyle = c.accent;
            g.fillRect(gx, bodyTop, 1, 5);
          } else if (l.level === 1) {
            g.globalAlpha = 0.6;
            g.fillStyle = c.surface;
            g.fillRect(gx, bodyTop, 1, bodyH);
            g.globalAlpha = 1;
            g.fillStyle = c.ink3;
            g.fillRect(gx, bodyTop, 1, 3);
          } else {
            g.fillStyle = c.ink3;
            g.fillRect(gx, bodyTop + bodyH - 4, 1, 4);
          }
        }
      }
      g.restore();
    }

    // 3. fades, headers, borders, handles
    for (const k of visible) {
      const { x0, x1, cx0, cx1 } = rect(k);
      const f = fades.get(k.id)!;
      const isSel = sel.has(k.id);
      g.save();
      g.beginPath();
      g.rect(cx0, y0, cx1 - cx0, y1 - y0);
      g.clip();
      g.strokeStyle = c.ink2;
      g.lineWidth = 1;
      if (f.fi > DECLICK * 1.5) this.fadePath(x0, x0 + f.fi * pps, bodyTop, bodyH, true);
      if (f.fo > DECLICK * 1.5) this.fadePath(x1 - f.fo * pps, x1, bodyTop, bodyH, false);

      g.fillStyle = isSel ? c.ink : c.head;
      g.fillRect(cx0, y0, cx1 - cx0, HEAD_H);
      g.fillStyle = c.line;
      g.fillRect(cx0, bodyTop - 1, cx1 - cx0, 1);
      this.drawHeaderText(k, x0, x1, y0, isSel);
      g.restore();

      g.strokeStyle = c.line;
      g.lineWidth = 1;
      g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);

      if (isSel || this.hoverId === k.id) {
        for (const hx of [x0 + k.fadeIn * pps, x1 - k.fadeOut * pps]) {
          const rx = Math.round(hx - HANDLE / 2) + 0.5;
          const ry = Math.round(bodyTop - HANDLE / 2) + 0.5;
          g.fillStyle = c.surface;
          g.fillRect(rx, ry, HANDLE - 1, HANDLE - 1);
          g.strokeStyle = c.ink;
          g.strokeRect(rx, ry, HANDLE - 1, HANDLE - 1);
        }
      }
    }
  }

  private fadePath(xa: number, xb: number, top: number, hgt: number, rising: boolean) {
    const g = this.g;
    const n = 32;
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const p = i / n;
      const v = rising ? Math.sin((Math.PI / 2) * p) : Math.cos((Math.PI / 2) * p);
      const x = xa + (xb - xa) * p;
      const y = top + hgt - v * (hgt - 1);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  private drawHeaderText(k: Clip, x0: number, x1: number, y0: number, isSel: boolean) {
    const g = this.g;
    const s = get();
    const c = this.col;
    const src = s.sources[k.sourceId];
    if (!src) return;
    const ty = y0 + 11;
    g.font = `500 10.5px ${getComputedStyle(document.body).fontFamily}`;
    const nameX = Math.max(x0, 0) + 5;
    g.fillStyle = isSel ? c.surface : c.ink;
    g.fillText(src.name, nameX, ty);
    let cursor = nameX + g.measureText(src.name).width + 10;
    g.font = `10px ${c.mono}`;
    g.fillStyle = isSel ? c.ink3 : c.ink2;
    if (src.status === 'analyzing') {
      g.fillText('분석 중…', cursor, ty);
      return;
    }
    const an = src.analysis;
    if (!an) return;
    const a = k.offset;
    const b = k.offset + k.duration;
    for (const seg of an.segments) {
      if (seg.end <= a || seg.start >= b || !seg.bpm) continue;
      const sx = this.xAt(k.start + Math.max(seg.start, a) - k.offset);
      const label = `${seg.bpm.toFixed(1)} BPM`;
      let lx = sx + 5;
      if (seg.start > a) {
        g.fillRect(Math.round(sx), y0, 1, HEAD_H);
      } else {
        lx = Math.max(lx, cursor);
      }
      if (lx > x1 - 8) continue;
      g.fillText(label, lx, ty);
      cursor = Math.max(cursor, lx + g.measureText(label).width + 10);
    }
  }
}

function rulerLabel(t: number, step: number): string {
  if (step >= 1) return fmtShort(t);
  const m = Math.floor(t / 60);
  const sec = t - m * 60;
  const digits = step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  const str = sec.toFixed(digits);
  return `${m}:${str.padStart(digits + 3, '0')}`;
}
