import { useEffect, useRef } from 'react';
import { ArrangementView } from './arrangementView';
import { Overview } from './Overview';

export function Arrangement() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const head = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const view = new ArrangementView(wrap.current!, canvas.current!, head.current!);
    return () => view.destroy();
  }, []);

  return (
    <section className="arrangement">
      <div className="arrangement-canvas" ref={wrap}>
        <canvas ref={canvas} />
        <div className="playhead" ref={head} />
      </div>
      <Overview />
    </section>
  );
}
