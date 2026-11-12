import { scheduleWindow, trackGain, type Project } from './engine';

export async function renderMix(p: Project, from: number, to: number, sampleRate = 44100): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil((to - from) * sampleRate));
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const bus = ctx.createGain();
  bus.connect(ctx.destination);
  const nodes = new Map<string, GainNode>();
  for (const t of p.tracks) {
    const g = ctx.createGain();
    g.gain.value = trackGain(t, p.tracks);
    g.connect(bus);
    nodes.set(t.id, g);
  }
  scheduleWindow(ctx, p, from, to, 0, (id) => nodes.get(id) ?? bus);
  const out = await ctx.startRendering();
  preventClipping(out);
  return out;
}

/** If the summed mix exceeds −0.3 dBFS, scale it down uniformly. Never boosts. */
function preventClipping(buf: AudioBuffer) {
  const chs = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  let peak = 0;
  for (const ch of chs) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  const ceiling = Math.pow(10, -0.3 / 20);
  if (peak <= ceiling) return;
  const k = ceiling / peak;
  for (const ch of chs) for (let i = 0; i < ch.length; i++) ch[i] *= k;
}

export function encodeWav(buf: AudioBuffer): Blob {
  const ch = Math.min(2, buf.numberOfChannels);
  const n = buf.length;
  const bytes = 44 + n * ch * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, ch, true);
  view.setUint32(24, buf.sampleRate, true);
  view.setUint32(28, buf.sampleRate * ch * 2, true);
  view.setUint16(32, ch * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}
