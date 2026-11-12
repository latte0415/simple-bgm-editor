import { create } from 'zustand';
import type { Clip, Id, Range, Source, TimeSel, Track } from './types';
import type { GridSetting } from '../lib/grid';
import { arrangementEnd } from './edit';
import { clamp } from '../lib/format';

export const MAX_TRACKS = 5;

export type JoinXf = 'off' | '10ms' | '1/16' | '1/8' | '1/4' | 'bar';
export const JOIN_OPTIONS: { value: JoinXf; label: string }[] = [
  { value: 'off', label: '없음' },
  { value: '10ms', label: '10 ms' },
  { value: '1/16', label: '1/16' },
  { value: '1/8', label: '1/8' },
  { value: '1/4', label: '1 박' },
  { value: 'bar', label: '1 마디' },
];

interface Snapshot {
  tracks: Track[];
  clips: Clip[];
}

export interface EditorState {
  sources: Record<Id, Source>;
  tracks: Track[];
  clips: Clip[];
  past: Snapshot[];
  future: Snapshot[];
  /** Bumped on every committed edit; the audio engine reschedules on change. */
  rev: number;

  selected: Id[];
  timeSel: TimeSel | null;
  /** Insert marker: where playback starts. */
  playhead: number;
  lastStop: number;

  pxPerSec: number;
  scrollX: number;
  viewWidth: number;

  grid: GridSetting;
  snap: boolean;
  joinXf: JoinXf;
  follow: boolean;

  playing: boolean;
  loopOn: boolean;
  loopRegion: Range | null;

  busy: string | null;
  notice: { text: string; kind: 'info' | 'error' } | null;
}

export const useEditor = create<EditorState>(() => ({
  sources: {},
  tracks: [],
  clips: [],
  past: [],
  future: [],
  rev: 0,
  selected: [],
  timeSel: null,
  playhead: 0,
  lastStop: 0,
  pxPerSec: 40,
  scrollX: 0,
  viewWidth: 1000,
  grid: 'auto',
  snap: true,
  joinXf: '1/4',
  follow: true,
  playing: false,
  loopOn: false,
  loopRegion: null,
  busy: null,
  notice: null,
}));

export const get = useEditor.getState;
export const set = useEditor.setState;

/* ------------------------------------------------------------- history */

export function pushHistory() {
  const s = get();
  set({ past: [...s.past.slice(-99), { tracks: s.tracks, clips: s.clips }], future: [] });
}

export function commit() {
  set((s) => ({ rev: s.rev + 1 }));
}

/** Snapshot, apply, commit. */
export function edit(patch: Partial<EditorState>) {
  pushHistory();
  set(patch);
  commit();
}

function restore(from: 'past' | 'future') {
  const s = get();
  const stack = s[from];
  if (!stack.length) return;
  const snap = stack[stack.length - 1];
  const cur = { tracks: s.tracks, clips: s.clips };
  const ids = new Set(snap.clips.map((c) => c.id));
  set({
    tracks: snap.tracks,
    clips: snap.clips,
    [from]: stack.slice(0, -1),
    [from === 'past' ? 'future' : 'past']: [...s[from === 'past' ? 'future' : 'past'], cur],
    selected: s.selected.filter((id) => ids.has(id)),
    rev: s.rev + 1,
  } as Partial<EditorState>);
}
export const undo = () => restore('past');
export const redo = () => restore('future');

/* ------------------------------------------------------------- notices */

let noticeTimer = 0;
export function notify(text: string, kind: 'info' | 'error' = 'info') {
  clearTimeout(noticeTimer);
  set({ notice: { text, kind } });
  noticeTimer = window.setTimeout(() => set({ notice: null }), kind === 'error' ? 6000 : 3000);
}

/* ---------------------------------------------------------------- view */

export const MIN_PPS = 0.5;
export const MAX_PPS = 6000;

function contentEnd() {
  return arrangementEnd(get().clips);
}

export function setScroll(x: number) {
  const s = get();
  const viewSec = s.viewWidth / s.pxPerSec;
  const max = Math.max(0, contentEnd() - viewSec * 0.5);
  set({ scrollX: clamp(x, 0, max) });
}

/** Zoom keeping the time under pixel `anchorX` fixed. */
export function zoomAt(factor: number, anchorX: number) {
  const s = get();
  const pps = clamp(s.pxPerSec * factor, MIN_PPS, MAX_PPS);
  const t = s.scrollX + anchorX / s.pxPerSec;
  set({ pxPerSec: pps, scrollX: Math.max(0, t - anchorX / pps) });
}

export function zoomToRange(a: number, b: number) {
  const s = get();
  const len = Math.max(0.05, b - a);
  const pps = clamp((s.viewWidth * 0.92) / len, MIN_PPS, MAX_PPS);
  set({ pxPerSec: pps, scrollX: Math.max(0, a - (s.viewWidth * 0.04) / pps) });
}

export function zoomToFit() {
  const end = contentEnd();
  if (end <= 0) return;
  zoomToRange(0, end);
}

export function zoomStep(dir: 1 | -1) {
  const s = get();
  const x = clamp((s.playhead - s.scrollX) * s.pxPerSec, 0, s.viewWidth);
  zoomAt(dir > 0 ? 1.5 : 1 / 1.5, x);
}
