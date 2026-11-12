import type { Analysis } from '../state/types';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (a: Analysis) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent) => {
    const { id, result, error } = e.data as { id: number; result?: Analysis; error?: string };
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (result) p.resolve(result);
    else p.reject(new Error(error ?? 'analysis failed'));
  };
  return worker;
}

/** Mixes down to mono at ~22 kHz and runs tempo/beat analysis off the main thread. */
export function analyzeBuffer(buf: AudioBuffer): Promise<Analysis> {
  const factor = Math.max(1, Math.round(buf.sampleRate / 22050));
  const n = Math.floor(buf.length / factor);
  const chs = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const out = new Float32Array(n);
  const norm = 1 / (factor * chs.length);
  for (const ch of chs) {
    for (let i = 0, j = 0; i < n; i++) {
      let s = 0;
      for (let k = 0; k < factor; k++) s += ch[j++];
      out[i] += s * norm;
    }
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage(
      { id, samples: out, sampleRate: buf.sampleRate / factor, duration: buf.duration },
      [out.buffer],
    );
  });
}
