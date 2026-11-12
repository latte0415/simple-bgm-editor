import { analyzeSamples } from './analysisCore';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(msg: unknown): void;
};

scope.onmessage = (e) => {
  const { id, samples, sampleRate, duration } = e.data as {
    id: number;
    samples: Float32Array;
    sampleRate: number;
    duration: number;
  };
  try {
    scope.postMessage({ id, result: analyzeSamples(samples, sampleRate, duration) });
  } catch (err) {
    scope.postMessage({ id, error: String(err) });
  }
};
