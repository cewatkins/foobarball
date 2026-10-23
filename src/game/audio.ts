let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let crowdBus: GainNode | null = null;
let cheer: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let started = false;
let muted = false;
let volume = 0.85;
let energy = 0.12;
let target = 0.12;

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
    sfxBus.gain.value = 0.9;
    crowdBus.gain.value = 0.85;
    sfxBus.connect(master);
    crowdBus.connect(master);
    master.connect(ctx.destination);
    master.gain.value = muted ? 0 : curve(volume);
    const n = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = n.getChannelData(0);
    let b = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      b = b * 0.96 + w * 0.04;
      data[i] = w * 0.65 + b * 6;
    }
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

export function resumeAudio(): void {
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

/** 0 idle stands, 1 a full roar. Decays toward the phase bed. */
export function pumpCrowd(n: number): void {
  energy = Math.max(energy, Math.max(0, Math.min(1, n)));
}

export function setCrowdBed(n: number): void {
  target = Math.max(0.04, Math.min(0.55, n));
}

export function tickAudio(dt: number): void {
  if (!ctx || !cheer) return;
  energy += (target - energy) * Math.min(1, dt * 1.4);
  cheer.gain.setTargetAtTime(0.012 + energy * 0.16, ctx.currentTime, 0.06);
}

function startCrowd(): void {
  if (!ctx || !noiseBuf || !crowdBus || started) return;
  started = true;
  const bed = ctx.createBufferSource();
  bed.buffer = noiseBuf;
  bed.loop = true;
  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 520;
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0.045;
  bed.connect(low);
  low.connect(bedGain);
  bedGain.connect(crowdBus);
  bed.start();

  const roar = ctx.createBufferSource();
  roar.buffer = noiseBuf;
  roar.loop = true;
  const mid = ctx.createBiquadFilter();
  mid.type = "bandpass";
  mid.frequency.value = 1400;
  mid.Q.value = 0.55;
  cheer = ctx.createGain();
  cheer.gain.value = 0.02;
  roar.connect(mid);
  mid.connect(cheer);
  cheer.connect(crowdBus);
  roar.start();

  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.18;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 90;
  lfo.connect(lfoGain);
  lfoGain.connect(mid.frequency);
  lfo.start();
}

function envGain(at: number, peak: number, dur: number, attack = 0.012): GainNode | null {
  if (!ctx || !sfxBus) return null;
  const g = ctx.createGain();
  g.connect(sfxBus);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  return g;
}

function tone(freq: number, dur: number, type: OscillatorType, peak: number, slide = 0, attack = 0.012): void {
  if (!ctx) return;
  const at = ctx.currentTime;
  const g = envGain(at, peak, dur, attack);
  if (!g) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(40, freq), at);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), at + dur * 0.9);
  o.connect(g);
  o.start(at);
  o.stop(at + dur + 0.02);
  o.onended = () => {
    o.disconnect();
    g.disconnect();
  };
}

function burst(dur: number, peak: number, freq: number, q = 0.7, type: BiquadFilterType = "bandpass"): void {
  if (!ctx || !noiseBuf) return;
  const at = ctx.currentTime;
  const g = envGain(at, peak, dur, 0.006);
  if (!g) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
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

function whistle(): void {
  if (!ctx) return;
  const at = ctx.currentTime;
  const g = envGain(at, 0.07, 0.42, 0.03);
  if (!g) return;
  const a = ctx.createOscillator();
  const b = ctx.createOscillator();
  a.type = "sine";
  b.type = "sine";
  a.frequency.setValueAtTime(3180, at);
  b.frequency.setValueAtTime(3340, at);
  a.frequency.linearRampToValueAtTime(3360, at + 0.28);
  b.frequency.linearRampToValueAtTime(3520, at + 0.28);
  a.connect(g);
  b.connect(g);
  a.start(at);
  b.start(at);
  a.stop(at + 0.46);
  b.stop(at + 0.46);
  burst(0.08, 0.03, 5000, 0.4, "highpass");
  a.onended = () => {
    a.disconnect();
    b.disconnect();
    g.disconnect();
  };
}

function thud(low: number): void {
  tone(low, 0.16, "sine", 0.28, -low * 0.55, 0.004);
  tone(low * 1.5, 0.08, "triangle", 0.08, -40, 0.004);
  burst(0.12, 0.22, 180, 0.6);
  burst(0.05, 0.12, 2400, 0.8, "highpass");
}

export function playSfx(name: string): void {
  if (!ensure() || muted || !name) return;
  const wobble = 0.94 + Math.random() * 0.12;
  switch (name) {
    case "snap":
      burst(0.05, 0.28, 2200, 0.9, "highpass");
      burst(0.09, 0.16, 240, 0.5);
      tone(180, 0.06, "sine", 0.1, -40, 0.004);
      pumpCrowd(0.32);
      break;
    case "pass":
      burst(0.16, 0.1, 1600, 0.45);
      tone(420 * wobble, 0.12, "triangle", 0.05, 220, 0.01);
      burst(0.08, 0.06, 700, 1.2);
      break;
    case "kick":
      thud(70);
      burst(0.18, 0.08, 900, 0.4);
      tone(160, 0.2, "sine", 0.08, 80);
      pumpCrowd(0.4);
      break;
    case "catch":
      burst(0.06, 0.2, 1800, 0.8);
      tone(540 * wobble, 0.07, "sine", 0.08);
      burst(0.1, 0.1, 400, 0.5);
      pumpCrowd(0.62);
      break;
    case "inc":
      tone(240, 0.16, "sine", 0.06, -90);
      burst(0.14, 0.1, 280, 0.5);
      thud(55);
      break;
    case "hit":
      thud(78);
      tone(140, 0.1, "square", 0.04, -60, 0.004);
      pumpCrowd(0.58);
      break;
    case "tackle":
      thud(64);
      burst(0.18, 0.16, 140, 0.45);
      pumpCrowd(0.5);
      break;
    case "juke":
      tone(480 * wobble, 0.05, "square", 0.035, 180, 0.004);
      burst(0.05, 0.05, 2000, 1);
      break;
    case "whistle":
      whistle();
      break;
    case "first":
      tone(523, 0.09, "triangle", 0.07);
      tone(659, 0.12, "triangle", 0.07);
      tone(784, 0.16, "sine", 0.05);
      pumpCrowd(0.7);
      break;
    case "td":
      tone(196, 0.22, "sawtooth", 0.04);
      tone(262, 0.28, "triangle", 0.06);
      tone(392, 0.34, "triangle", 0.06);
      tone(523, 0.42, "sine", 0.05);
      burst(0.35, 0.08, 500, 0.4);
      pumpCrowd(1);
      break;
    case "int":
      tone(440, 0.1, "square", 0.045, -80);
      tone(330, 0.18, "square", 0.04, -40);
      burst(0.12, 0.1, 700, 0.6);
      pumpCrowd(0.75);
      break;
    case "miss":
      tone(220, 0.2, "sine", 0.06, -80);
      tone(175, 0.28, "triangle", 0.04, -30);
      burst(0.16, 0.06, 300, 0.4);
      break;
    default:
      break;
  }
}
