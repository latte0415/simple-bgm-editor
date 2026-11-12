import { useEffect, useRef, useState } from 'react';
import { MAX_TRACKS, useEditor } from '../state/store';
import { importFiles, importYoutube } from '../state/commands';
import { IconFile } from './icons';

export function ImportBar() {
  const [url, setUrl] = useState('');
  const busy = useEditor((s) => s.busy);
  const used = useEditor((s) => new Set(s.clips.map((c) => c.trackId)).size);
  const fileRef = useRef<HTMLInputElement>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [busy]);

  const full = used >= MAX_TRACKS;

  return (
    <div className="importbar">
      <form
        className="url-form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = url.trim();
          if (!v) return;
          void importYoutube(v);
          setUrl('');
          (document.activeElement as HTMLElement | null)?.blur();
        }}
      >
        <span className="label">YouTube</span>
        <input
          className="url-input"
          type="url"
          inputMode="url"
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          disabled={full}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" className="btn" disabled={!url.trim() || !!busy || full}>추출</button>
      </form>
      <span className="or">또는</span>
      <button className="btn" disabled={!!busy || full} onClick={() => fileRef.current?.click()}>
        <IconFile /> 오디오 파일
      </button>
      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.aif,.aiff,.webm"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) void importFiles(files);
        }}
      />
      <div className="import-status" aria-live="polite">
        {busy && (
          <>
            <span className="pulse" />
            {busy} <span className="mono muted">{elapsed}s</span>
          </>
        )}
      </div>
      <div className="slots mono">
        {Array.from({ length: MAX_TRACKS }, (_, i) => <span key={i} className={i < used ? 'slot used' : 'slot'} />)}
        <span className="muted">{used}/{MAX_TRACKS}</span>
      </div>
    </div>
  );
}
