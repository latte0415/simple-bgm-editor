import { useEffect, useState } from 'react';
import { Toolbar } from './Toolbar';
import { ImportBar } from './ImportBar';
import { TrackList } from './TrackList';
import { Arrangement } from './Arrangement';
import { Inspector } from './Inspector';
import { useShortcuts } from './useShortcuts';
import { HelpPanel } from './HelpPanel';
import { useEditor } from '../state/store';
import { importFiles, importYoutube } from '../state/commands';

export function App() {
  useShortcuts();
  const notice = useEditor((s) => s.notice);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      const text = e.clipboardData?.getData('text')?.trim() ?? '';
      if (/^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(text)) {
        e.preventDefault();
        void importYoutube(text);
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().clips.length) e.preventDefault();
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) void importFiles([...e.dataTransfer.files]);
      }}
    >
      <Toolbar />
      <ImportBar />
      <main className="main">
        <TrackList />
        <Arrangement />
      </main>
      <Inspector />
      {notice && <div className={`notice notice-${notice.kind}`} role="status">{notice.text}</div>}
      {dragging && <div className="dropzone"><span>놓아서 트랙에 추가</span></div>}
      <HelpPanel />
    </div>
  );
}
