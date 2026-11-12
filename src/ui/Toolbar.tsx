import { useEffect, useRef } from 'react';
import { JOIN_OPTIONS, redo, set, undo, useEditor, zoomStep, zoomToFit, type JoinXf } from '../state/store';
import { exportWav, toggleLoop } from '../state/commands';
import { position, togglePlay } from '../audio/transport';
import { GRID_OPTIONS, beatIndexAt, type GridSetting } from '../lib/grid';
import { clipEnd } from '../state/edit';
import { fmtTime } from '../lib/format';
import { IconDownload, IconFit, IconFollow, IconLoop, IconMagnet, IconMinus, IconPlay, IconPlus, IconRedo, IconStop, IconUndo } from './icons';
import { toggleHelp, useHelpOpen } from './HelpPanel';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl+';

/** Tempo and bar.beat at time t, read from the top-most audible clip. */
function tempoAt(t: number): { bpm: string; pos: string } {
  const s = useEditor.getState();
  for (const tr of s.tracks) {
    if (tr.muted) continue;
    const c = s.clips.find((k) => k.trackId === tr.id && t >= k.start && t < clipEnd(k));
    const an = c && s.sources[c.sourceId]?.analysis;
    if (!c || !an || an.beats.length < 2) continue;
    const st = c.offset + (t - c.start);
    const seg = an.segments.find((g) => st >= g.start && st < g.end) ?? an.segments[an.segments.length - 1];
    const k = Math.floor(beatIndexAt(an.beats, st) + 1e-6);
    const rel = k - an.downbeatPhase;
    const bar = Math.floor(rel / 4) + 1;
    const beat = (((rel % 4) + 4) % 4) + 1;
    return { bpm: seg?.bpm ? seg.bpm.toFixed(1) : '—', pos: `${bar}.${beat}` };
  }
  return { bpm: '—', pos: '—' };
}

function Readout() {
  const timeRef = useRef<HTMLSpanElement>(null);
  const bpmRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const loop = () => {
      const p = position();
      const { bpm, pos } = tempoAt(p);
      const key = `${fmtTime(p)}|${bpm}|${pos}`;
      if (key !== last) {
        last = key;
        timeRef.current!.textContent = fmtTime(p);
        bpmRef.current!.textContent = bpm;
        barRef.current!.textContent = pos;
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="readout">
      <div className="readout-cell"><span className="label">위치</span><span className="value mono" ref={timeRef} /></div>
      <div className="readout-cell"><span className="label">마디</span><span className="value mono" ref={barRef} /></div>
      <div className="readout-cell"><span className="label">BPM</span><span className="value mono" ref={bpmRef} /></div>
    </div>
  );
}

export function Toolbar() {
  const playing = useEditor((s) => s.playing);
  const loopOn = useEditor((s) => s.loopOn);
  const follow = useEditor((s) => s.follow);
  const grid = useEditor((s) => s.grid);
  const snap = useEditor((s) => s.snap);
  const joinXf = useEditor((s) => s.joinXf);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const hasClips = useEditor((s) => s.clips.length > 0);
  const busy = useEditor((s) => s.busy);
  const helpOpen = useHelpOpen();

  return (
    <header className="toolbar">
      <div className="brand">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 8h2M4 5v6M7 2v12M10 4v8M13 6v4" /></svg>
        <span>BGM Editor</span>
      </div>

      <div className="group">
        <button className={`icon-btn ${playing ? 'on' : ''}`} title="재생 / 정지 (Space)" onClick={() => togglePlay()}>
          {playing ? <IconStop /> : <IconPlay />}
        </button>
        <button className={`icon-btn ${loopOn ? 'on-accent' : ''}`} title={`선택 구간 루프 (${MOD}L)`} onClick={toggleLoop}><IconLoop /></button>
        <button className={`icon-btn ${follow ? 'on' : ''}`} title="재생 위치 따라가기" onClick={() => set({ follow: !follow })}><IconFollow /></button>
      </div>

      <Readout />

      <div className="group">
        <label className="select-field" title="스냅 그리드 (박자 기준)">
          <span className="label">그리드</span>
          <select value={grid} onChange={(e) => { set({ grid: e.target.value as GridSetting }); e.target.blur(); }}>
            {GRID_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <button className={`icon-btn ${snap ? 'on' : ''}`} title="스냅 (드래그 중 ⌥ 로 일시 해제)" onClick={() => set({ snap: !snap })}><IconMagnet /></button>
        <label className="select-field" title="구간을 잘라내고 이을 때 자동으로 겹칠 크로스페이드 길이">
          <span className="label">이음 페이드</span>
          <select value={joinXf} onChange={(e) => { set({ joinXf: e.target.value as JoinXf }); e.target.blur(); }}>
            {JOIN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>

      <div className="group">
        <button className="icon-btn" title="축소 (−)" onClick={() => zoomStep(-1)}><IconMinus /></button>
        <button className="icon-btn" title="확대 (+)" onClick={() => zoomStep(1)}><IconPlus /></button>
        <button className="icon-btn" title="전체 보기" onClick={zoomToFit}><IconFit /></button>
      </div>

      <div className="group">
        <button className="icon-btn" title={`실행 취소 (${MOD}Z)`} disabled={!canUndo} onClick={undo}><IconUndo /></button>
        <button className="icon-btn" title={`다시 실행 (${MOD}⇧Z)`} disabled={!canRedo} onClick={redo}><IconRedo /></button>
      </div>

      <div className="spacer" />
      <div className="group">
        <button className={`icon-btn ${helpOpen ? 'on' : ''}`} title="사용법 (?)" aria-label="사용법" onClick={toggleHelp}><span className="help-glyph">?</span></button>
      </div>
      <button className="btn btn-primary" disabled={!hasClips || !!busy} onClick={exportWav}>
        <IconDownload /> WAV 내보내기
      </button>
    </header>
  );
}
