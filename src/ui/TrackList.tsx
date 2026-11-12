import { MAX_TRACKS, useEditor } from '../state/store';
import { addTrack, removeTrack, updateTrack } from '../state/commands';
import type { Track } from '../state/types';
import { fmtShort } from '../lib/format';
import { LANE_H, RULER_H } from './layout';
import { IconClose } from './icons';

function TrackRow({ track, index }: { track: Track; index: number }) {
  const meta = useEditor((s) => {
    const clips = s.clips.filter((c) => c.trackId === track.id);
    if (!clips.length) return '비어 있음';
    const src = s.sources[clips[0].sourceId];
    if (!src) return '';
    const len = fmtShort(src.buffer.duration);
    if (src.status === 'analyzing') return `${len} · 템포 분석 중`;
    if (!src.analysis?.bpm) return `${len} · 템포 없음`;
    const n = src.analysis.segments.length;
    return `${len} · ${src.analysis.bpm.toFixed(1)} BPM${n > 1 ? ` · ${n}구간` : ''}`;
  });
  const db = track.volumeDb;
  return (
    <div className="track-row" style={{ height: LANE_H }}>
      <div className="track-top">
        <span className="track-index mono">{String(index + 1).padStart(2, '0')}</span>
        <input
          className="track-name"
          value={track.name}
          spellCheck={false}
          onChange={(e) => updateTrack(track.id, { name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <button className="icon-btn ghost" title="트랙 삭제" onClick={() => removeTrack(track.id)}><IconClose /></button>
      </div>
      <div className="track-meta mono">{meta}</div>
      <div className="track-ctrl">
        <button className={`toggle ${track.muted ? 'on' : ''}`} title="뮤트" onClick={() => updateTrack(track.id, { muted: !track.muted })}>M</button>
        <button className={`toggle ${track.solo ? 'on-accent' : ''}`} title="솔로" onClick={() => updateTrack(track.id, { solo: !track.solo })}>S</button>
        <input
          className="fader"
          type="range"
          min={-40}
          max={6}
          step={0.5}
          value={db}
          title="볼륨 (더블클릭: 0 dB)"
          onChange={(e) => updateTrack(track.id, { volumeDb: Number(e.target.value) })}
          onDoubleClick={() => updateTrack(track.id, { volumeDb: 0 })}
          onPointerUp={(e) => (e.target as HTMLInputElement).blur()}
        />
        <span className="db mono">{db <= -40 ? '−∞' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`}</span>
      </div>
    </div>
  );
}

export function TrackList() {
  const tracks = useEditor((s) => s.tracks);
  return (
    <aside className="tracklist">
      <div className="tracklist-head" style={{ height: RULER_H }}>
        <span className="label">트랙</span>
      </div>
      {tracks.map((t, i) => <TrackRow key={t.id} track={t} index={i} />)}
      {tracks.length > 0 && tracks.length < MAX_TRACKS && (
        <button className="add-track" onClick={addTrack}>+ 빈 트랙 추가</button>
      )}
    </aside>
  );
}
