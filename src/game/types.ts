export type TeamId = 0 | 1;
export type Phase = "menu" | "lobby" | "call" | "presnap" | "live" | "dead" | "fg" | "pat" | "final";
export type Mode = "route" | "block" | "rush" | "man" | "zone" | "spy" | "pursue" | "idle";
export type Kind = "scrimmage" | "return";

export interface Pt {
  f: number;
  l: number;
}

export interface Athlete {
  num: number;
  name: string;
  spd: number;
  ol: boolean;
}

export interface OffPlay {
  id: string;
  name: string;
  formation: string;
  group: "run" | "pass";
  blurb: string;
  /** Roster indexes highlighted as throw buttons, in order. */
  hot: number[];
  handoffAt: number;
  throwAt: number;
  jobs: Array<"route" | "block">;
  routes: Pt[][];
  align: Slot[];
}

export interface DefPlay {
  id: string;
  name: string;
  blurb: string;
  align: Slot[];
  jobs: Array<"rush" | "man" | "zone" | "spy">;
  /** Offense roster index to mirror, or -1. */
  man: number[];
  /** Zone landmark, yards past the line of scrimmage / lateral. */
  zone: Pt[];
  press: boolean;
}

export interface Slot {
  d: number;
  l: number;
}

export interface Player {
  id: number;
  team: TeamId;
  idx: number;
  num: number;
  name: string;
  spd: number;
  ol: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  mode: Mode;
  path: { x: number; y: number }[];
  pi: number;
  man: number;
  zx: number;
  zy: number;
  down: boolean;
  grip: number;
  shed: number;
  juke: number;
  jukeCd: number;
  diving: number;
  blockT: number;
}

export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  tx: number;
  ty: number;
  tz: number;
  carrier: number;
  state: "held" | "air" | "dead";
  flight: number;
  hang: number;
}

export interface Pad {
  ax: number;
  ay: number;
  snap: boolean;
  throwTo: number | null;
  juke: boolean;
  dive: boolean;
  switch: boolean;
}

export interface Queue {
  t: "call" | "ko" | "pat" | "final" | "spot" | "ball";
  team?: TeamId;
  x?: number;
  first?: boolean;
}

export interface Kick {
  team: TeamId;
  dist: number;
  kind: "fg" | "xp";
  t: number;
}

export interface Stats {
  rush: number;
  pass: number;
  td: number;
  sack: number;
  takeaway: number;
  fg: number;
}

export interface GameState {
  phase: Phase;
  simLocal: boolean;
  online: boolean;
  myTeam: TeamId;
  human: [boolean, boolean];
  sharp: boolean;
  q: number;
  clock: number;
  clockRunning: boolean;
  freeze: boolean;
  playClock: number;
  down: number;
  toGo: number;
  los: number;
  dir: 1 | -1;
  poss: TeamId;
  score: [number, number];
  players: Player[];
  ball: Ball;
  ctrl: [number, number];
  chosen: [string | null, string | null];
  offId: string;
  defId: string;
  kind: Kind;
  liveT: number;
  startLos: number;
  thrown: boolean;
  handed: boolean;
  twoPt: boolean;
  patTeam: TeamId;
  banner: string;
  sub: string;
  deadT: number;
  queue: Queue | null;
  fg: Kick | null;
  log: string[];
  stats: [Stats, Stats];
  shake: number;
  sfx: string;
  sfxN: number;
  seed: number;
  paused: boolean;
  snapN: number;
  seen: boolean;
  lastN: number;
  endNote: string;
}

export const QUARTER = 360;
export const FIELD_L = 10;
export const FIELD_R = 110;
export const SIDELINE = 26.65;
