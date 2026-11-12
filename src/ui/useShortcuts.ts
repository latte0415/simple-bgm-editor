import { useEffect } from 'react';
import { get, redo, set, undo, zoomStep, zoomToFit, zoomToRange } from '../state/store';
import { duplicate, remove, selectAll, split, toggleLoop } from '../state/commands';
import { seek, togglePlay } from '../audio/transport';
import { closeHelp, isHelpOpen, toggleHelp } from './HelpPanel';

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el?.closest('input, textarea, select')) return;
      // Help panel: `?` toggles it; while open it swallows everything but Esc.
      if ((e.key === '?' || (e.code === 'Slash' && e.shiftKey)) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); return toggleHelp(); }
      if (isHelpOpen()) {
        if (e.key === 'Escape') { e.preventDefault(); closeHelp(); }
        return;
      }
      if (el?.tagName === 'BUTTON') el.blur();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const run = (fn: () => void) => { e.preventDefault(); fn(); };

      if (e.code === 'Space') return run(() => togglePlay(e.shiftKey));
      if (mod && k === 'z') return run(() => (e.shiftKey ? redo() : undo()));
      if (mod && k === 'y') return run(redo);
      if (mod && k === 'e') return run(split);
      if (mod && k === 'd') return run(duplicate);
      if (mod && k === 'l') return run(toggleLoop);
      if (mod && k === 'a') return run(selectAll);
      if (mod) return;
      if (k === 'backspace' || k === 'delete') return run(() => remove(e.shiftKey));
      if (k === '+' || k === '=') return run(() => zoomStep(1));
      if (k === '-' || k === '_') return run(() => zoomStep(-1));
      if (k === 'l') return run(toggleLoop);
      if (k === 's' && !e.shiftKey) return run(split);
      if (k === 'z') {
        return run(() => {
          const s = get();
          if (s.timeSel && s.timeSel.end - s.timeSel.start > 1e-3) zoomToRange(s.timeSel.start, s.timeSel.end);
          else zoomToFit();
        });
      }
      if (k === 'escape') return run(() => set({ selected: [], timeSel: null }));
      if (k === 'home' || k === 'enter') return run(() => seek(0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
