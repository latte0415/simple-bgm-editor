import { engine } from './engine';
import { get, set, useEditor, type EditorState } from '../state/store';

const loopOf = (s: EditorState) => (s.loopOn ? s.loopRegion : null);

export function play(from?: number) {
  const s = get();
  const ok = engine.play(from ?? s.playhead, s, loopOf(s));
  set({ playing: ok });
}

export function stop() {
  const pos = engine.position();
  engine.stop();
  set({ playing: false, lastStop: Number.isFinite(pos) ? pos : get().playhead });
}

/** Space: play from insert marker / stop. Shift+Space: continue from where playback stopped. */
export function togglePlay(resume = false) {
  if (get().playing) stop();
  else play(resume ? get().lastStop : undefined);
}

export function seek(t: number) {
  set({ playhead: Math.max(0, t) });
  if (get().playing) play(Math.max(0, t));
}

export function position(): number {
  return get().playing ? engine.position() : get().playhead;
}

engine.onEnded = () => set({ playing: false });

useEditor.subscribe((s, prev) => {
  if (s.tracks !== prev.tracks) engine.updateTrackGains(s.tracks);
  if (!s.playing) return;
  if (s.rev !== prev.rev || s.loopOn !== prev.loopOn || s.loopRegion !== prev.loopRegion) {
    const pos = engine.position();
    engine.play(Number.isFinite(pos) ? pos : s.playhead, s, loopOf(s));
  }
});
