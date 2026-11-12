export type Id = string;

/** A stretch of the source with a stable tempo. Times are in source seconds. */
export interface TempoSegment {
  start: number;
  end: number;
  bpm: number;
}

export interface Analysis {
  /** Beat positions in source seconds, ascending. */
  beats: number[];
  segments: TempoSegment[];
  /** Index (0-3) of the first downbeat within `beats`, assuming 4/4. */
  downbeatPhase: number;
  /** Representative tempo of the whole source. */
  bpm: number;
}

export interface PeakLevel {
  bucket: number;
  min: Float32Array;
  max: Float32Array;
  /** Mean square per bucket. */
  ms: Float32Array;
}

export interface Peaks {
  channels: Float32Array[];
  length: number;
  sampleRate: number;
  levels: PeakLevel[];
}

export interface Source {
  id: Id;
  name: string;
  buffer: AudioBuffer;
  peaks: Peaks;
  analysis: Analysis | null;
  status: 'analyzing' | 'ready' | 'error';
}

export interface Clip {
  id: Id;
  sourceId: Id;
  trackId: Id;
  /** Position on the timeline (s). */
  start: number;
  /** Position inside the source where playback begins (s). */
  offset: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
  gainDb: number;
}

export interface Track {
  id: Id;
  name: string;
  muted: boolean;
  solo: boolean;
  volumeDb: number;
}

export interface TimeSel {
  start: number;
  end: number;
  trackIds: Id[];
}

export interface Range {
  start: number;
  end: number;
}
