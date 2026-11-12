import type { Analysis, Clip, Id, Track } from './types';
import { MAX_TRACKS, commit, edit, get, notify, pushHistory, set, zoomToFit, type JoinXf } from './store';
import { arrangementEnd, clipEnd, removeRange, splitClip } from './edit';
import { beatLengthAt } from '../lib/grid';
import { uid } from '../lib/format';
import { apiFetch } from '../lib/api';
import { engine } from '../audio/engine';
import { computePeaks } from '../audio/peaks';
import { analyzeBuffer } from '../audio/analyze';
import { encodeWav, renderMix } from '../audio/export';

/* -------------------------------------------------------------- import */

function emptyTrack(tracks: Track[], clips: Clip[]) {
  return tracks.find((t) => !clips.some((c) => c.trackId === t.id));
}

export function freeSlots(): number {
  const s = get();
  return MAX_TRACKS - s.tracks.length + (emptyTrack(s.tracks, s.clips) ? 1 : 0);
}

export async function importAudio(data: ArrayBuffer, name: string) {
  if (freeSlots() <= 0) throw new Error(`트랙은 최대 ${MAX_TRACKS}개까지 사용할 수 있습니다.`);
  let buffer: AudioBuffer;
  try {
    buffer = await engine.decode(data);
  } catch {
    throw new Error('오디오를 디코딩할 수 없습니다. 지원되는 형식인지 확인하세요.');
  }
  if (freeSlots() <= 0) throw new Error(`트랙은 최대 ${MAX_TRACKS}개까지 사용할 수 있습니다.`);

  const id = uid('src');
  const s = get();
  const first = s.clips.length === 0;
  let tracks = s.tracks;
  let track = emptyTrack(tracks, s.clips);
  if (track) {
    tracks = tracks.map((t) => (t.id === track!.id ? { ...t, name } : t));
  } else {
    track = { id: uid('trk'), name, muted: false, solo: false, volumeDb: 0 };
    tracks = [...tracks, track];
  }
  const clip: Clip = {
    id: uid('clip'),
    sourceId: id,
    trackId: track.id,
    start: 0,
    offset: 0,
    duration: buffer.duration,
    fadeIn: 0,
    fadeOut: 0,
    gainDb: 0,
  };
  pushHistory();
  set({
    sources: { ...s.sources, [id]: { id, name, buffer, peaks: computePeaks(buffer), analysis: null, status: 'analyzing' } },
    tracks,
    clips: [...s.clips, clip],
    selected: [clip.id],
    timeSel: null,
  });
  commit();
  if (first) zoomToFit();

  analyzeBuffer(buffer).then(
    (analysis) => updateSource(id, { analysis, status: 'ready' }),
    () => {
      updateSource(id, { status: 'error' });
      notify(`${name}: 템포 분석에 실패했습니다.`, 'error');
    },
  );
}

function updateSource(id: Id, patch: { analysis?: Analysis; status?: 'ready' | 'error' }) {
  const src = get().sources[id];
  if (!src) return;
  set({ sources: { ...get().sources, [id]: { ...src, ...patch } } });
}

export async function fetchYoutube(url: string): Promise<{ data: ArrayBuffer; title: string }> {
  let res: Response;
  try {
    res = await apiFetch('/api/youtube', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  } catch {
    throw new Error('추출 서버에 연결할 수 없습니다.');
  }
  if (res.status === 401) throw new Error('입장 비밀번호를 다시 입력한 뒤 시도하세요.');
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error ?? `추출 실패 (HTTP ${res.status})`);
  }
  const title = decodeURIComponent(res.headers.get('x-title') ?? '') || 'YouTube';
  return { data: await res.arrayBuffer(), title };
}

export async function importYoutube(url: string) {
  if (get().busy) return;
  if (freeSlots() <= 0) {
    notify(`트랙은 최대 ${MAX_TRACKS}개까지 사용할 수 있습니다.`, 'error');
    return;
  }
  set({ busy: 'YouTube에서 오디오 추출 중' });
  try {
    const { data, title } = await fetchYoutube(url);
    set({ busy: '디코딩 중' });
    await importAudio(data, title);
  } catch (e) {
    notify((e as Error).message, 'error');
  } finally {
    set({ busy: null });
  }
}

export async function importFiles(files: File[]) {
  const audio = files.filter((f) => f.type.startsWith('audio/') || f.type.startsWith('video/') || /\.(mp3|wav|m4a|aac|flac|ogg|opus|webm|aiff?)$/i.test(f.name));
  if (!audio.length) {
    notify('오디오 파일이 아닙니다.', 'error');
    return;
  }
  for (const f of audio) {
    if (freeSlots() <= 0) {
      notify(`트랙은 최대 ${MAX_TRACKS}개까지 사용할 수 있습니다.`, 'error');
      break;
    }
    set({ busy: `${f.name} 불러오는 중` });
    try {
      await importAudio(await f.arrayBuffer(), f.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }
  set({ busy: null });
}

/* -------------------------------------------------------------- tracks */

export function addTrack() {
  const s = get();
  if (s.tracks.length >= MAX_TRACKS) return notify(`트랙은 최대 ${MAX_TRACKS}개까지 사용할 수 있습니다.`, 'error');
  edit({ tracks: [...s.tracks, { id: uid('trk'), name: `트랙 ${s.tracks.length + 1}`, muted: false, solo: false, volumeDb: 0 }] });
}

export function removeTrack(id: Id) {
  const s = get();
  edit({
    tracks: s.tracks.filter((t) => t.id !== id),
    clips: s.clips.filter((c) => c.trackId !== id),
    timeSel: null,
  });
}

/** Mixer changes are not part of undo history. */
export function updateTrack(id: Id, patch: Partial<Track>) {
  set({ tracks: get().tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
}

/* --------------------------------------------------------------- edits */

export function updateClip(id: Id, patch: Partial<Clip>) {
  edit({ clips: get().clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
}

function hasRange() {
  const t = get().timeSel;
  return !!t && t.end - t.start > 1e-6;
}

export function split() {
  const s = get();
  let times: number[];
  let tracks: Set<Id>;
  let only: Set<Id> | null = null;
  if (s.timeSel) {
    times = hasRange() ? [s.timeSel.start, s.timeSel.end] : [s.timeSel.start];
    tracks = new Set(s.timeSel.trackIds);
  } else if (s.selected.length) {
    times = [s.playhead];
    only = new Set(s.selected);
    tracks = new Set(s.clips.filter((c) => only!.has(c.id)).map((c) => c.trackId));
  } else {
    return notify('분할할 클립이나 위치를 먼저 선택하세요.');
  }
  let clips = s.clips;
  let changed = false;
  for (const t of times) {
    clips = clips.flatMap((c) => {
      if (!tracks.has(c.trackId) || (only && !only.has(c.id))) return [c];
      const r = splitClip(c, t);
      if (!r) return [c];
      changed = true;
      only?.add(r[1].id);
      return r;
    });
  }
  if (!changed) return;
  let selected: Id[] = [];
  if (s.timeSel && hasRange()) {
    const { start, end } = s.timeSel;
    selected = clips.filter((c) => tracks.has(c.trackId) && c.start >= start - 1e-6 && clipEnd(c) <= end + 1e-6).map((c) => c.id);
  }
  edit({ clips, selected });
}

function joinLength(xf: JoinXf, sources: ReturnType<typeof get>['sources']) {
  return (r: Clip) => {
    if (xf === 'off') return 0;
    if (xf === '10ms') return 0.01;
    const an = sources[r.sourceId]?.analysis;
    const beat = an ? beatLengthAt(an, r.offset) : 0.5;
    return { '1/16': beat / 4, '1/8': beat / 2, '1/4': beat, bar: beat * 4 }[xf];
  };
}

/** Delete selected range or clips. `ripple` closes the gap (Delete Time). */
export function remove(ripple: boolean) {
  const s = get();
  const join = joinLength(s.joinXf, s.sources);
  if (s.timeSel && hasRange()) {
    const { start, end, trackIds } = s.timeSel;
    const clips = removeRange(s.clips, new Set(trackIds), start, end, ripple, join);
    edit({
      clips,
      selected: [],
      timeSel: ripple ? { start, end: start, trackIds } : null,
      playhead: start,
    });
    return;
  }
  if (!s.selected.length) return;
  if (!ripple) {
    const ids = new Set(s.selected);
    edit({ clips: s.clips.filter((c) => !ids.has(c.id)), selected: [] });
    return;
  }
  // Ripple-delete each selected clip, latest first so earlier ranges stay valid.
  const targets = s.clips.filter((c) => s.selected.includes(c.id)).sort((a, b) => b.start - a.start);
  let clips = s.clips;
  for (const c of targets) {
    clips = clips.filter((x) => x.id !== c.id);
    clips = removeRange(clips, new Set([c.trackId]), c.start, clipEnd(c), true, join);
  }
  edit({ clips, selected: [] });
}

export function duplicate() {
  const s = get();
  const sel = s.clips.filter((c) => s.selected.includes(c.id));
  if (!sel.length) return;
  const a = Math.min(...sel.map((c) => c.start));
  const b = Math.max(...sel.map(clipEnd));
  const copies = sel.map((c) => ({ ...c, id: uid('clip'), start: c.start + (b - a) }));
  edit({ clips: [...s.clips, ...copies], selected: copies.map((c) => c.id) });
}

export function selectAll() {
  set({ selected: get().clips.map((c) => c.id), timeSel: null });
}

export function toggleLoop() {
  const s = get();
  if (s.timeSel && s.timeSel.end - s.timeSel.start > 0.05) {
    const r = { start: s.timeSel.start, end: s.timeSel.end };
    const same = s.loopRegion && Math.abs(s.loopRegion.start - r.start) < 1e-6 && Math.abs(s.loopRegion.end - r.end) < 1e-6;
    set({ loopRegion: r, loopOn: same ? !s.loopOn : true });
  } else if (s.loopRegion) {
    set({ loopOn: !s.loopOn });
  } else {
    notify('루프할 구간을 먼저 드래그로 선택하세요.');
  }
}

/* -------------------------------------------------------- source tempo */

export function scaleTempo(sourceId: Id, factor: 2 | 0.5) {
  const src = get().sources[sourceId];
  const an = src?.analysis;
  if (!an || an.beats.length < 4) return;
  let beats: number[];
  let phase: number;
  if (factor === 2) {
    beats = [];
    for (let i = 0; i < an.beats.length; i++) {
      beats.push(an.beats[i]);
      if (i + 1 < an.beats.length) beats.push((an.beats[i] + an.beats[i + 1]) / 2);
    }
    phase = (an.downbeatPhase * 2) % 4;
  } else {
    const keep = an.downbeatPhase % 2;
    beats = an.beats.filter((_, i) => i % 2 === keep);
    phase = ((an.downbeatPhase - keep) / 2) % 4;
  }
  const r1 = (v: number) => Math.round(v * 10) / 10;
  updateSource(sourceId, {
    analysis: {
      beats,
      downbeatPhase: phase,
      bpm: r1(an.bpm * factor),
      segments: an.segments.map((g) => ({ ...g, bpm: r1(g.bpm * factor) })),
    },
  });
}

export function shiftDownbeat(sourceId: Id) {
  const an = get().sources[sourceId]?.analysis;
  if (!an) return;
  updateSource(sourceId, { analysis: { ...an, downbeatPhase: (an.downbeatPhase + 1) % 4 } });
}

/* -------------------------------------------------------------- export */

export async function exportWav() {
  const s = get();
  const end = arrangementEnd(s.clips);
  if (end <= 0) return notify('내보낼 클립이 없습니다.');
  set({ busy: 'WAV 렌더링 중' });
  try {
    const buf = await renderMix(s, 0, end);
    const blob = encodeWav(buf);
    const name = (s.tracks[0]?.name || 'mix').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-edit.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } catch (e) {
    notify(`내보내기 실패: ${(e as Error).message}`, 'error');
  } finally {
    set({ busy: null });
  }
}
