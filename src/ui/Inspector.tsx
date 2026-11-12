import { useEffect, useState, type ReactNode } from 'react';
import { useEditor, zoomToRange } from '../state/store';
import { remove, scaleTempo, shiftDownbeat, split, toggleLoop, updateClip } from '../state/commands';
import { beatsBetween } from '../lib/grid';
import { clipEnd } from '../state/edit';
import { fmtTime } from '../lib/format';
import type { Clip, Source } from '../state/types';
import { MOD } from './Toolbar';

function Cell({ label, children, grow }: { label: string; children: ReactNode; grow?: boolean }) {
  return (
    <div className={`cell ${grow ? 'grow' : ''}`}>
      <span className="label">{label}</span>
      <div className="cell-value">{children}</div>
    </div>
  );
}

function NumField({ value, unit, onCommit, digits = 0, min, max }: {
  value: number; unit: string; onCommit: (v: number) => void; digits?: number; min?: number; max?: number;
}) {
  const fmt = (v: number) => v.toFixed(digits);
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commitText = () => {
    const v = Number(text.replace(',', '.'));
    if (!Number.isFinite(v)) return setText(fmt(value));
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    if (Math.abs(c - value) > 1e-9) onCommit(c);
    setText(fmt(c));
  };
  return (
    <label className="numfield">
      <input
        className="mono"
        value={text}
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setText(fmt(value)); (e.target as HTMLInputElement).blur(); }
        }}
      />
      <span className="unit">{unit}</span>
    </label>
  );
}

function ClipInspector({ clip, src }: { clip: Clip; src: Source }) {
  const an = src.analysis;
  const beats = an ? beatsBetween(an, clip.offset, clip.offset + clip.duration) : 0;
  const segs = an?.segments.filter((g) => g.end > clip.offset && g.start < clip.offset + clip.duration && g.bpm) ?? [];
  return (
    <div className="inspector-row">
      <Cell label="클립" grow>
        <span className="clip-name">{src.name}</span>
      </Cell>
      <Cell label="시작"><span className="mono">{fmtTime(clip.start)}</span></Cell>
      <Cell label="길이">
        <span className="mono">{fmtTime(clip.duration)}</span>
        {beats > 0 && <span className="mono muted"> · {beats.toFixed(beats % 1 < 0.05 || beats % 1 > 0.95 ? 0 : 1)}박</span>}
      </Cell>
      <Cell label="원본 위치"><span className="mono">{fmtTime(clip.offset)}</span></Cell>
      <Cell label="페이드 인">
        <NumField value={clip.fadeIn * 1000} unit="ms" min={0} max={(clip.duration - clip.fadeOut) * 1000} onCommit={(v) => updateClip(clip.id, { fadeIn: v / 1000 })} />
      </Cell>
      <Cell label="페이드 아웃">
        <NumField value={clip.fadeOut * 1000} unit="ms" min={0} max={(clip.duration - clip.fadeIn) * 1000} onCommit={(v) => updateClip(clip.id, { fadeOut: v / 1000 })} />
      </Cell>
      <Cell label="게인">
        <NumField value={clip.gainDb} unit="dB" digits={1} min={-60} max={12} onCommit={(v) => updateClip(clip.id, { gainDb: v })} />
      </Cell>
      <Cell label="템포" grow>
        {src.status === 'analyzing' && <span className="muted">분석 중…</span>}
        {src.status === 'error' && <span className="muted">분석 실패</span>}
        {src.status === 'ready' && !segs.length && <span className="muted">박자를 찾지 못함</span>}
        <span className="segs">
          {segs.map((g) => (
            <span key={g.start} className="seg mono" title={`원본 ${fmtTime(g.start)} – ${fmtTime(g.end)}`}>
              {fmtTime(g.start).slice(0, -4)} <b>{g.bpm.toFixed(1)}</b>
            </span>
          ))}
        </span>
      </Cell>
      <Cell label="박자 보정">
        <div className="btn-row">
          <button className="btn sm" disabled={!an} title="BPM을 두 배로 (박자 사이에 박 추가)" onClick={() => scaleTempo(src.id, 2)}>×2</button>
          <button className="btn sm" disabled={!an} title="BPM을 절반으로" onClick={() => scaleTempo(src.id, 0.5)}>÷2</button>
          <button className="btn sm" disabled={!an} title="마디 첫 박 위치를 한 박 이동" onClick={() => shiftDownbeat(src.id)}>첫 박 +1</button>
        </div>
      </Cell>
    </div>
  );
}

function RangeInspector() {
  const sel = useEditor((s) => s.timeSel)!;
  const beats = useEditor((s) => {
    for (const id of sel.trackIds) {
      const c = s.clips.find((k) => k.trackId === id && sel.start >= k.start - 1e-6 && sel.start < clipEnd(k));
      const an = c && s.sources[c.sourceId]?.analysis;
      if (c && an && an.beats.length > 1) {
        return beatsBetween(an, c.offset + sel.start - c.start, c.offset + sel.end - c.start);
      }
    }
    return 0;
  });
  const len = sel.end - sel.start;
  return (
    <div className="inspector-row">
      <Cell label="선택 구간" grow>
        <span className="mono">{fmtTime(sel.start)} – {fmtTime(sel.end)}</span>
        <span className="mono muted"> · {len.toFixed(3)}s{beats > 0 ? ` · ${beats.toFixed(Math.abs(beats - Math.round(beats)) < 0.05 ? 0 : 2)}박` : ''} · {sel.trackIds.length}트랙</span>
      </Cell>
      <Cell label="편집">
        <div className="btn-row">
          <button className="btn sm" onClick={split}>분할 <kbd>{MOD}E</kbd></button>
          <button className="btn sm" onClick={() => remove(false)}>지우기 <kbd>⌫</kbd></button>
          <button className="btn sm btn-primary" onClick={() => remove(true)}>잘라내고 잇기 <kbd>⇧⌫</kbd></button>
          <button className="btn sm" onClick={toggleLoop}>루프 <kbd>{MOD}L</kbd></button>
          <button className="btn sm" onClick={() => zoomToRange(sel.start, sel.end)}>확대 <kbd>Z</kbd></button>
        </div>
      </Cell>
    </div>
  );
}

const HELP: [string, string][] = [
  ['Space', '재생 / 정지'],
  ['⇧Space', '멈춘 곳부터'],
  [`${MOD}E`, '분할'],
  ['⌫', '지우기'],
  ['⇧⌫', '잘라내고 잇기'],
  [`${MOD}D`, '복제'],
  [`${MOD}L`, '루프'],
  [`${MOD}Z`, '실행 취소'],
  ['+ −', '확대 / 축소'],
  ['Z', '선택 확대'],
  ['⌥ 드래그', '스냅 해제'],
];

function Help() {
  return (
    <div className="inspector-row help">
      <Cell label="마우스">
        <span className="keys">
          <span>상단 바 드래그 — 이동</span>
          <span>본문 드래그 — 구간 선택</span>
          <span>가장자리 — 트림</span>
          <span>□ 핸들 — 페이드</span>
          <span>겹치면 자동 크로스페이드</span>
        </span>
      </Cell>
      <Cell label="단축키">
        <span className="keys">
          {HELP.map(([k, v]) => <span key={k}><kbd>{k}</kbd> {v}</span>)}
        </span>
      </Cell>
    </div>
  );
}

export function Inspector() {
  const clip = useEditor((s) => (s.selected.length === 1 ? s.clips.find((c) => c.id === s.selected[0]) ?? null : null));
  const src = useEditor((s) => (clip ? s.sources[clip.sourceId] ?? null : null));
  const hasRange = useEditor((s) => !!s.timeSel && s.timeSel.end - s.timeSel.start > 1e-6);
  const multi = useEditor((s) => s.selected.length);
  return (
    <footer className="inspector">
      {hasRange ? <RangeInspector /> : clip && src ? <ClipInspector clip={clip} src={src} /> : multi > 1 ? (
        <div className="inspector-row"><Cell label="선택" grow><span>{multi}개 클립</span></Cell></div>
      ) : <Help />}
    </footer>
  );
}
