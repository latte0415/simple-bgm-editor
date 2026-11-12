import { useEffect, useRef } from 'react';
import { get, set, useEditor } from '../state/store';
import { arrangementEnd, clipEnd } from '../state/edit';
import { OVERVIEW_H } from './layout';

/** Whole-arrangement strip with the visible range framed; click or drag to navigate. */
export function Overview() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const g = cv.getContext('2d')!;
    let w = 0;
    let raf = 0;
    const total = () => {
      const s = get();
      return Math.max(arrangementEnd(s.clips) * 1.05, s.scrollX + s.viewWidth / s.pxPerSec, 1);
    };
    const draw = () => {
      raf = 0;
      const s = get();
      const cs = getComputedStyle(document.documentElement);
      const T = total();
      const k = w / T;
      g.clearRect(0, 0, w, OVERVIEW_H);
      const n = Math.max(1, s.tracks.length);
      const rowH = (OVERVIEW_H - 6) / n;
      g.fillStyle = cs.getPropertyValue('--ink-3');
      s.tracks.forEach((tr, i) => {
        for (const c of s.clips) {
          if (c.trackId !== tr.id) continue;
          g.fillRect(c.start * k, 3 + i * rowH, Math.max(1, (clipEnd(c) - c.start) * k), Math.max(1, rowH - 1));
        }
      });
      const a = s.scrollX * k;
      const b = (s.scrollX + s.viewWidth / s.pxPerSec) * k;
      g.strokeStyle = cs.getPropertyValue('--ink');
      g.lineWidth = 1;
      g.strokeRect(Math.round(a) + 0.5, 0.5, Math.max(4, Math.round(b - a) - 1), OVERVIEW_H - 1);
    };
    const request = () => { if (!raf) raf = requestAnimationFrame(draw); };
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      w = cv.parentElement!.clientWidth;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(OVERVIEW_H * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${OVERVIEW_H}px`;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    });
    ro.observe(cv.parentElement!);
    const unsub = useEditor.subscribe(request);

    let dragging = false;
    const jump = (e: PointerEvent) => {
      const s = get();
      const x = e.clientX - cv.getBoundingClientRect().left;
      const t = (x / w) * total();
      set({ scrollX: Math.max(0, t - s.viewWidth / s.pxPerSec / 2) });
    };
    const down = (e: PointerEvent) => { dragging = true; cv.setPointerCapture(e.pointerId); jump(e); };
    const move = (e: PointerEvent) => { if (dragging) jump(e); };
    const up = () => { dragging = false; };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    return () => {
      ro.disconnect();
      unsub();
      cancelAnimationFrame(raf);
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
    };
  }, []);

  return (
    <div className="overview">
      <canvas ref={ref} />
    </div>
  );
}
