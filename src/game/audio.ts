let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let crowdBus: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let crowdSrc: AudioBufferSourceNode | null = null;
let muted = false;
let volume = 0.8;

function curve(v: number): number {
  return v * v;
}

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: "interactive" });
    master = ctx.createGain();
    sfxBus = ctx.createGain();
    crowdBus = ctx.createGain();
    sfxBus.connect(master);
    crowdBus.connect(master);
    master.connect(ctx.destination);
    master.gain.value = muted ? 0 : curve(volume);
    const n = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = n.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuf = n;
  }
  return ctx;
}

export function unlockAudio(): void {
  const c = ensure();
  if (c && c.state === "suspended") void c.resume();
  startCrowd();
}

export function setMuted(next: boolean): void {
  muted = next;
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : curve(volume), ctx.currentTime, 0.03);
}

export function isMuted(): boolean {
  return muted;
}

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  if (master && ctx && !muted) master.gain.setTargetAtTime(curve(volume), ctx.currentTime, 0.03);
}

function startCrowd(): void {
  if (!ctx || !noiseBuf || !crowdBus || crowdSrc) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 420;
  const g = ctx.createGain();
  g.gain.value = 0.018;
  src.connect(filter);
  filter.connect(g);
  g.connect(crowdBus);
  src.start();
  crowdSrc = src;
}

function envGain(at: number, peak: number, dur: number): GainNode | null {
  if (!ctx || !sfxBus) return null;
  const g = ctx.createGain();
  g.connect(sfxBus);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  return g;
}

function tone(freq: number, dur: number, type: OscillatorType, peak: number, slide = 0): void {
  if (!ctx) return;
  const at = ctx.currentTime;
  const g = envGain(at, peak, dur);
  if (!g) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), at + dur);
  o.connect(g);
  o.start(at);
  o.stop(at + dur + 0.02);
  o.onended = () => {
    o.disconnect();
    g.disconnect();
  };
}

function burst(dur: number, peak: number, freq: number): void {
  if (!ctx || !noiseBuf) return;
  const at = ctx.currentTime;
  const g = envGain(at, peak, dur);
  if (!g) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 0.7;
  src.connect(filter);
  filter.connect(g);
  src.start(at);
  src.stop(at + dur);
  src.onended = () => {
    src.disconnect();
    filter.disconnect();
    g.disconnect();
  };
}

export function playSfx(name: string): void {
  if (!ensure() || muted || !name) return;
  const wobble = 0.94 + Math.random() * 0.12;
  switch (name) {
    case "snap":
      burst(0.09, 0.22, 180);
      tone(140, 0.08, "sine", 0.18);
      break;
    case "pass":
      burst(0.12, 0.12, 900);
      tone(520 * wobble, 0.09, "triangle", 0.08, 80);
      break;
    case "catch":
      tone(660 * wobble, 0.1, "sine", 0.12);
      burst(0.08, 0.16, 1400);
      break;
    case "inc":
      tone(220, 0.18, "sine", 0.08, -80);
      burst(0.14, 0.08, 300);
      break;
    case "hit":
    case "tackle":
      burst(0.16, 0.28, 160);
      tone(90, 0.18, "sine", 0.2, -40);
      break;
    case "juke":
      tone(340 * wobble, 0.07, "square", 0.05, 120);
      break;
    case "whistle":
      tone(1480, 0.22, "sine", 0.07, 180);
      tone(1760, 0.18, "sine", 0.04, -60);
      break;
    case "first":
      tone(523, 0.1, "triangle", 0.08);
      tone(659, 0.14, "triangle", 0.07);
      break;
    case "td":
      tone(523, 0.16, "sawtooth", 0.05);
      tone(659, 0.18, "sawtooth", 0.05);
      tone(784, 0.28, "triangle", 0.08);
      burst(0.2, 0.1, 240);
      break;
    case "int":
      tone(392, 0.12, "square", 0.06);
      tone(311, 0.2, "square", 0.05);
      burst(0.12, 0.12, 500);
      break;
    case "miss":
      tone(196, 0.22, "sine", 0.07, -70);
      break;
    default:
      break;
  }
}

export function resumeAudio(): void {
  if (ctx && ctx.state === "suspended") void ctx.resume();
}
