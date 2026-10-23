import { ACES, cpuDef, cpuOff, defById, KINGS, offById } from "./plays.ts";
import type {
  Ball,
  GameState,
  Kick,
  Kind,
  Mode,
  Pad,
  Player,
  Queue,
  Stats,
  TeamId,
} from "./types.ts";
import { FIELD_L, FIELD_R, QUARTER, SIDELINE } from "./types.ts";

export const neutralPad = (): Pad => ({
  ax: 0,
  ay: 0,
  snap: false,
  throwTo: null,
  juke: false,
  dive: false,
  switch: false,
});

const emptyStats = (): Stats => ({ rush: 0, pass: 0, td: 0, sack: 0, takeaway: 0, fg: 0 });

function rng(s: GameState): number {
  s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0;
  return s.seed / 4294967296;
}

function makePlayer(team: TeamId, idx: number): Player {
  const a = (team === 0 ? ACES : KINGS)[idx]!;
  return {
    id: team * 11 + idx,
    team,
    idx,
    num: a.num,
    name: a.name,
    spd: a.spd,
    ol: a.ol,
    x: 60,
    y: (idx - 5) * 3,
    vx: 0,
    vy: 0,
    tx: 60,
    ty: 0,
    mode: "idle",
    path: [],
    pi: 0,
    man: -1,
    zx: 60,
    zy: 0,
    down: false,
    grip: 0,
    shed: 0,
    juke: 0,
    jukeCd: 0,
    diving: 0,
    blockT: 0,
  };
}

function makeBall(): Ball {
  return {
    x: 35,
    y: 0,
    z: 1.2,
    vx: 0,
    vy: 0,
    vz: 0,
    tx: 35,
    ty: 0,
    tz: 1.2,
    carrier: 1,
    state: "held",
    flight: 0,
    hang: 0.8,
  };
}

export function createMatch(): GameState {
  const players: Player[] = [];
  for (const team of [0, 1] as const) for (let i = 0; i < 11; i++) players.push(makePlayer(team, i));
  return {
    phase: "menu",
    simLocal: true,
    online: false,
    myTeam: 0,
    human: [true, false],
    sharp: false,
    q: 1,
    clock: QUARTER,
    clockRunning: true,
    freeze: false,
    playClock: 20,
    down: 1,
    toGo: 10,
    los: 35,
    dir: 1,
    poss: 0,
    score: [0, 0],
    players,
    ball: makeBall(),
    ctrl: [1, 15],
    chosen: [null, null],
    offId: "zone",
    defId: "cover2",
    kind: "return",
    liveT: 0,
    startLos: 35,
    thrown: false,
    handed: false,
    twoPt: false,
    patTeam: 0,
    banner: "",
    sub: "",
    deadT: 0,
    queue: null,
    fg: null,
    log: [],
    stats: [emptyStats(), emptyStats()],
    shake: 0,
    sfx: "",
    sfxN: 0,
    seed: 0x51ed,
    paused: false,
    snapN: 0,
    seen: false,
    lastN: 0,
    endNote: "",
  };
}

export function viewYaw(dir: number, vx: number, vy: number): number {
  return Math.atan2(-(dir * vy), dir * vx);
}

export function distGoal(team: TeamId, x: number): number {
  return team === 0 ? FIELD_R - x : x - FIELD_L;
}

export function spotName(x: number): string {
  const fromLeft = x - FIELD_L;
  if (fromLeft >= 49 && fromLeft <= 51) return "50";
  const yard = fromLeft <= 50 ? fromLeft : 100 - fromLeft;
  const side = fromLeft < 50 ? "ACES" : "KINGS";
  return `${side} ${Math.max(1, Math.round(yard))}`;
}

export function downText(s: GameState): string {
  const names = ["", "1ST", "2ND", "3RD", "4TH"];
  const goal = distGoal(s.poss, s.los);
  const tg = goal <= s.toGo + 0.2 ? "GOAL" : String(Math.max(1, Math.round(s.toGo)));
  return `${names[s.down] ?? "1ST"} & ${tg}`;
}

function P(s: GameState, team: TeamId, idx: number): Player {
  return s.players[team * 11 + idx]!;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

function say(s: GameState, banner: string, sub = ""): void {
  s.banner = banner;
  s.sub = sub;
  if (banner) {
    s.log.unshift(sub ? `${banner} · ${sub}` : banner);
    s.log.length = 7;
  }
}

function sfx(s: GameState, name: string): void {
  s.sfx = name;
  s.sfxN += 1;
}

function own25(team: TeamId): number {
  return team === 0 ? 35 : 85;
}

function pushLogQuiet(s: GameState, line: string): void {
  s.log.unshift(line);
  s.log.length = 7;
}

export function beginSolo(s: GameState, sharp = false): void {
  const fresh = createMatch();
  Object.assign(s, fresh, { players: s.players, ball: s.ball, stats: s.stats, log: s.log });
  s.players.splice(0, s.players.length, ...fresh.players);
  Object.assign(s.ball, fresh.ball);
  s.stats[0] = emptyStats();
  s.stats[1] = emptyStats();
  s.log.length = 0;
  s.sharp = sharp;
  s.human = [true, false];
  s.myTeam = 0;
  s.simLocal = true;
  s.online = false;
  s.seed = (Date.now() ^ 0x9e3779b9) >>> 0;
  setupReturn(s, 0, 30);
  say(s, "KICKOFF", "Bring it out");
  sfx(s, "whistle");
}

export function armOnline(s: GameState, myTeam: TeamId, simLocal: boolean): void {
  const fresh = createMatch();
  s.players.splice(0, s.players.length, ...fresh.players);
  Object.assign(s.ball, fresh.ball);
  Object.assign(s, {
    ...fresh,
    players: s.players,
    ball: s.ball,
    stats: [emptyStats(), emptyStats()] as [Stats, Stats],
    log: [] as string[],
    myTeam,
    simLocal,
    online: true,
    human: [true, true] as [boolean, boolean],
    phase: "lobby" as const,
    seed: (Date.now() ^ (myTeam + 1) * 997) >>> 0,
  });
}

export function hostKickoff(s: GameState): void {
  s.score = [0, 0];
  s.q = 1;
  s.clock = QUARTER;
  s.stats = [emptyStats(), emptyStats()];
  s.log = [];
  s.twoPt = false;
  setupReturn(s, 0, 30);
  say(s, "KICKOFF", "Ridge receives");
  sfx(s, "whistle");
}

function setupReturn(s: GameState, receiving: TeamId, spot: number): void {
  const dir: 1 | -1 = receiving === 0 ? 1 : -1;
  s.poss = receiving;
  s.dir = dir;
  s.los = spot;
  s.down = 1;
  s.toGo = 10;
  s.kind = "return";
  s.phase = "live";
  s.liveT = 0;
  s.thrown = false;
  s.handed = false;
  s.startLos = spot;
  s.twoPt = false;
  s.fg = null;
  s.clockRunning = true;
  s.freeze = false;
  const ySpread = [-16, -10, -6, -2, 2, 6, 10, 16, -13, 13, 0];
  for (let i = 0; i < 11; i++) {
    const rec = P(s, receiving, i);
    const cov = P(s, (1 - receiving) as TeamId, i);
    resetAthlete(rec);
    resetAthlete(cov);
    if (i === 1) {
      rec.x = spot;
      rec.y = 0;
      rec.mode = "route";
      rec.path = [
        { x: spot + dir * 12, y: 2 },
        { x: spot + dir * 28, y: -4 },
        { x: spot + dir * 55, y: 0 },
      ];
    } else {
      rec.x = spot + dir * 2.5;
      rec.y = (ySpread[i] ?? 0) * 0.7;
      rec.mode = "block";
      rec.path = [{ x: rec.x + dir * 8, y: rec.y }];
    }
    cov.x = spot + dir * (16 + (i % 3));
    cov.y = (i - 5) * 4.6;
    cov.y = clamp(cov.y, -24, 24);
    cov.mode = "pursue";
  }
  const carrier = P(s, receiving, 1);
  s.ball.state = "held";
  s.ball.carrier = carrier.id;
  s.ball.x = carrier.x;
  s.ball.y = carrier.y;
  s.ball.z = 1.3;
  s.ctrl[receiving] = carrier.id;
  s.ctrl[(1 - receiving) as TeamId] = (1 - receiving) * 11 + 2;
  s.queue = null;
}

function resetAthlete(p: Player): void {
  p.vx = 0;
  p.vy = 0;
  p.mode = "idle";
  p.path = [];
  p.pi = 0;
  p.man = -1;
  p.down = false;
  p.grip = 0;
  p.shed = 0;
  p.juke = 0;
  p.diving = 0;
  p.blockT = 0;
}

function lineup(s: GameState): void {
  const off = offById(s.offId);
  const def = defById(s.defId);
  const dir = s.dir;
  const los = s.los;
  for (let i = 0; i < 11; i++) {
    const o = P(s, s.poss, i);
    const dTeam = (1 - s.poss) as TeamId;
    const d = P(s, dTeam, i);
    resetAthlete(o);
    resetAthlete(d);
    const os = off.align[i] ?? { d: 1, l: 0 };
    const ds = def.align[i] ?? { d: 2, l: 0 };
    o.x = los - dir * os.d;
    o.y = dir * os.l;
    d.x = los + dir * ds.d;
    d.y = dir * ds.l;
    o.y = clamp(o.y, -25.5, 25.5);
    d.y = clamp(d.y, -25.5, 25.5);
    const rel = off.routes[i] ?? [];
    o.path = rel.map((w) => ({ x: o.x + dir * w.f, y: o.y + dir * w.l }));
    o.mode = off.jobs[i] === "block" ? "block" : "route";
    const job = def.jobs[i] ?? "zone";
    d.mode = job === "rush" ? "rush" : job === "man" ? "man" : job === "spy" ? "spy" : "zone";
    const manIdx = def.man[i] ?? -1;
    d.man = manIdx >= 0 ? s.poss * 11 + manIdx : -1;
    const z = def.zone[i] ?? { f: 6, l: 0 };
    d.zx = los + dir * z.f;
    d.zy = dir * z.l;
  }
  const qb = P(s, s.poss, 0);
  s.ball.state = "held";
  s.ball.carrier = qb.id;
  s.ball.x = qb.x;
  s.ball.y = qb.y;
  s.ball.z = 1.4;
  s.ctrl[s.poss] = qb.id;
  autoDef(s, (1 - s.poss) as TeamId);
  s.thrown = false;
  s.handed = off.group === "run" && off.handoffAt > 20;
  s.kind = "scrimmage";
  s.liveT = 0;
  s.startLos = s.los;
}

function autoDef(s: GameState, team: TeamId): void {
  const ball = s.ball;
  let best = team * 11 + 4;
  let bd = 1e9;
  for (const i of [4, 1, 5, 2, 3, 0, 10]) {
    const p = P(s, team, i);
    const d = dist(p.x, p.y, ball.x, ball.y) + (p.ol ? 8 : 0);
    if (d < bd) {
      bd = d;
      best = p.id;
    }
  }
  s.ctrl[team] = best;
}

function maybePresnap(s: GameState): void {
  if (s.chosen[0] && s.chosen[1] && s.phase === "call") {
    const offTeam = s.poss;
    const defTeam = (1 - s.poss) as TeamId;
    const offChoice = s.chosen[offTeam]!;
    const defChoice = s.chosen[defTeam]!;
    if (offChoice === "fg") {
      startKick(s, offTeam, "fg");
      return;
    }
    if (offChoice === "punt") {
      doPunt(s);
      return;
    }
    s.offId = offChoice;
    s.defId = defChoice;
    lineup(s);
    s.phase = "presnap";
    s.liveT = 0;
    say(s, "SET", offById(offChoice).formation);
  }
}

export function choosePlay(s: GameState, team: TeamId, id: string): void {
  if (s.phase !== "call") return;
  const offense = team === s.poss;
  if (offense && id !== "fg" && id !== "punt" && !offById(id)) return;
  if (!offense && id !== "fg" && id !== "punt") {
    s.chosen[team] = defById(id).id;
  } else if (offense) {
    s.chosen[team] = id;
  } else return;
  if (!offense && (id === "fg" || id === "punt")) return;
  maybePresnap(s);
}

function enterCall(s: GameState): void {
  s.phase = "call";
  s.playClock = s.twoPt ? 12 : 20;
  s.chosen = [null, null];
  s.fg = null;
  s.banner = s.twoPt ? "TWO-POINT TRY" : s.banner;
  for (const team of [0, 1] as const) {
    if (!s.human[team]) s.chosen[team] = cpuPick(s, team);
  }
  maybePresnap(s);
}

function cpuPick(s: GameState, team: TeamId): string {
  const dist = distGoal(s.poss, s.los);
  const r = rng(s);
  if (team === s.poss) {
    if (!s.twoPt && s.down === 4) {
      if (dist < 38 && dist > 12) return r < 0.62 ? "fg" : cpuOff(s.down, s.toGo, dist, r);
      if (dist >= 38) return r < 0.75 ? "punt" : cpuOff(s.down, s.toGo, dist, r);
    }
    return cpuOff(s.down, s.toGo, dist, r);
  }
  return cpuDef(s.down, s.toGo, dist, r);
}

function giveBall(s: GameState, team: TeamId, x: number, first: boolean): void {
  s.poss = team;
  s.dir = team === 0 ? 1 : -1;
  const goal = distGoal(team, x);
  const spot = clamp(x, team === 0 ? 12 : 12, team === 0 ? 108 : 108);
  // Keep the spot out of both end zones.
  const clamped = clamp(spot, FIELD_L + 1, FIELD_R - 1);
  s.los = clamped;
  s.down = 1;
  s.toGo = first ? Math.min(10, Math.max(0.5, distGoal(team, clamped))) : Math.min(10, goal);
  if (!first) s.toGo = Math.min(10, distGoal(team, clamped));
  s.clockRunning = true;
}

function applyQueue(s: GameState): void {
  const q: Queue | null = s.queue;
  s.queue = null;
  if (!q || q.t === "final") {
    s.phase = "final";
    s.endNote = s.score[0] === s.score[1] ? "Tie game" : s.score[0] > s.score[1] ? "Ridge Aces win" : "Vesper Kings win";
    sfx(s, "whistle");
    return;
  }
  if (q.t === "pat") {
    s.phase = "pat";
    say(s, "TOUCHDOWN", "Kick or go for two");
    return;
  }
  if (q.t === "ko") {
    setupReturn(s, (q.team ?? 0) as TeamId, q.team === 1 ? 90 : 30);
    say(s, "KICKOFF", `${q.team === 0 ? "Aces" : "Kings"} receive`);
    sfx(s, "whistle");
    return;
  }
  if (q.t === "ball" || q.t === "spot" || q.t === "call") {
    if (q.t === "ball" && q.team !== undefined && q.x !== undefined) {
      giveBall(s, q.team, q.x, true);
    } else if (q.x !== undefined) {
      const team = s.poss;
      s.los = clamp(q.x, FIELD_L + 1, FIELD_R - 1);
      if (q.first) {
        s.down = 1;
        s.toGo = Math.min(10, Math.max(0.5, distGoal(team, s.los)));
      }
      s.dir = team === 0 ? 1 : -1;
    }
    if (quarterOver(s)) return;
    enterCall(s);
  }
}

function quarterOver(s: GameState): boolean {
  if (s.clock > 0) return false;
  s.clock = 0;
  if (s.q < 4) {
    s.q += 1;
    s.clock = QUARTER;
    s.clockRunning = s.q !== 3;
    if (s.q === 3) say(s, "HALFTIME", "Third quarter next");
    return false;
  }
  if (s.q === 4 && s.score[0] === s.score[1]) {
    s.q = 5;
    s.clock = 300;
    s.clockRunning = true;
    say(s, "OVERTIME", "Next score wins");
    return false;
  }
  if (s.q >= 4 && s.score[0] !== s.score[1]) {
    s.queue = { t: "final" };
    s.phase = "dead";
    s.deadT = 0.2;
    return true;
  }
  if (s.q >= 5) {
    s.queue = { t: "final" };
    s.phase = "dead";
    s.deadT = 0.2;
    return true;
  }
  return false;
}

function scoreTD(s: GameState, team: TeamId): void {
  if (s.twoPt) {
    s.score[team] += 2;
    s.stats[team].td += 1;
    say(s, "TWO-POINT GOOD", `${team === 0 ? "Aces" : "Kings"} +2`);
    s.shake = 0.8;
    sfx(s, "td");
    finishScore(s, team, true);
    return;
  }
  s.score[team] += 6;
  s.stats[team].td += 1;
  say(s, "TOUCHDOWN", `${P(s, team, s.ball.carrier >= 0 ? s.players[s.ball.carrier]!.idx : 0).name}`);
  s.shake = 1;
  sfx(s, "td");
  if (s.q >= 5) {
    s.queue = { t: "final" };
    s.phase = "dead";
    s.deadT = 0;
    return;
  }
  s.patTeam = team;
  s.twoPt = false;
  s.queue = { t: "pat" };
  s.phase = "dead";
  s.deadT = 0;
}

function finishScore(s: GameState, scoring: TeamId, kickoff: boolean): void {
  if (s.q >= 5) {
    s.queue = { t: "final" };
    s.phase = "dead";
    s.deadT = 0;
    return;
  }
  s.twoPt = false;
  if (kickoff) {
    s.queue = { t: "ko", team: (1 - scoring) as TeamId };
    s.phase = "dead";
    s.deadT = 0;
  }
}

function scoreSafety(s: GameState, scoring: TeamId): void {
  s.score[scoring] += 2;
  say(s, "SAFETY", `${scoring === 0 ? "Aces" : "Kings"} +2`);
  s.shake = 0.7;
  sfx(s, "hit");
  if (s.q >= 5) {
    s.queue = { t: "final" };
    s.phase = "dead";
    s.deadT = 0;
    return;
  }
  s.queue = { t: "ball", team: scoring, x: own25(scoring) };
  s.phase = "dead";
  s.deadT = 0;
  s.clockRunning = false;
}

export function startKick(s: GameState, team: TeamId, kind: "fg" | "xp"): void {
  const dir: 1 | -1 = team === 0 ? 1 : -1;
  if (kind === "xp") s.los = team === 0 ? 95 : 25;
  const toGoal = Math.abs((dir === 1 ? FIELD_R : FIELD_L) - s.los);
  const dist = Math.round(toGoal + 17);
  const kick: Kick = { team, dist, kind, t: 0 };
  s.fg = kick;
  s.phase = "fg";
  s.twoPt = false;
  say(s, kind === "xp" ? "EXTRA POINT" : `${dist} YARD FIELD GOAL`, "Time the bar");
}

export function startTwo(s: GameState): void {
  const team = s.patTeam;
  s.twoPt = true;
  s.poss = team;
  s.dir = team === 0 ? 1 : -1;
  s.los = team === 0 ? 108 : 12;
  s.down = 1;
  s.toGo = 2;
  s.clockRunning = false;
  enterCall(s);
  say(s, "TWO-POINT TRY", "From the 2");
}

export function resolveKick(s: GameState, accuracy: number): void {
  if (s.phase !== "fg" || !s.fg) return;
  const kick = s.fg;
  const sweet = kick.dist < 30 ? 0.3 : kick.dist < 40 ? 0.2 : kick.dist < 50 ? 0.12 : 0.07;
  const good = Math.abs(accuracy) < sweet;
  if (good) {
    const pts = kick.kind === "xp" ? 1 : 3;
    s.score[kick.team] += pts;
    if (kick.kind === "fg") s.stats[kick.team].fg += 1;
    say(s, kick.kind === "xp" ? "EXTRA POINT" : "FIELD GOAL", `${kick.dist} yards`);
    sfx(s, "td");
    s.shake = 0.45;
    if (s.q >= 5 && kick.kind === "fg") {
      s.queue = { t: "final" };
      s.phase = "dead";
      s.deadT = 0;
      s.fg = null;
      return;
    }
  } else {
    say(s, "NO GOOD", kick.kind === "xp" ? "Extra point missed" : `${kick.dist} yards`);
    sfx(s, "miss");
    if (kick.kind === "fg") {
      const recv = (1 - kick.team) as TeamId;
      s.fg = null;
      s.queue = { t: "ball", team: recv, x: clamp(s.los, FIELD_L + 1, FIELD_R - 1) };
      s.phase = "dead";
      s.deadT = 0;
      s.clockRunning = false;
      return;
    }
  }
  s.fg = null;
  s.twoPt = false;
  s.queue = { t: "ko", team: (1 - kick.team) as TeamId };
  s.phase = "dead";
  s.deadT = 0;
}

function doPunt(s: GameState): void {
  const net = 36 + rng(s) * 12;
  const land = s.los + s.dir * net;
  const recv = (1 - s.poss) as TeamId;
  const crossed = s.dir === 1 ? land >= FIELD_R : land <= FIELD_L;
  s.clock = Math.max(0, s.clock - 6);
  if (crossed) {
    say(s, "TOUCHBACK", `${recv === 0 ? "Aces" : "Kings"} ball at the 25`);
    sfx(s, "whistle");
    s.queue = { t: "ball", team: recv, x: own25(recv) };
    s.phase = "dead";
    s.deadT = 0;
    s.clockRunning = false;
    return;
  }
  const spot = clamp(land, FIELD_L + 8, FIELD_R - 8);
  setupReturn(s, recv, spot);
  say(s, "PUNT", `${Math.round(net)} yard kick`);
  sfx(s, "pass");
}

function whistleIncomplete(s: GameState): void {
  s.ball.state = "dead";
  s.ball.z = 0;
  s.clockRunning = false;
  if (s.twoPt) {
    say(s, "NO GOOD", "Two-point fails");
    sfx(s, "inc");
    s.queue = { t: "ko", team: (1 - s.poss) as TeamId };
    s.twoPt = false;
    s.phase = "dead";
    s.deadT = 0;
    return;
  }
  s.down += 1;
  say(s, "INCOMPLETE", downText(s));
  sfx(s, "inc");
  if (s.down > 4) {
    const recv = (1 - s.poss) as TeamId;
    say(s, "TURNOVER ON DOWNS", spotName(s.los));
    s.queue = { t: "ball", team: recv, x: s.los };
  } else s.queue = { t: "spot", x: s.los };
  s.phase = "dead";
  s.deadT = 0;
}

function whistleDown(s: GameState, why: "tackle" | "oob" | "sack" | "dive"): void {
  const carrier = s.ball.carrier >= 0 ? s.players[s.ball.carrier] : undefined;
  if (!carrier) {
    whistleIncomplete(s);
    return;
  }
  if ((carrier.team === 0 && carrier.x >= FIELD_R) || (carrier.team === 1 && carrier.x <= FIELD_L)) {
    scoreTD(s, carrier.team);
    return;
  }
  const ownEz = carrier.team === 0 ? carrier.x <= FIELD_L : carrier.x >= FIELD_R;
  if (ownEz) {
    if (s.kind === "return") {
      say(s, "TOUCHBACK", "Ball at the 25");
      sfx(s, "whistle");
      s.queue = { t: "ball", team: carrier.team, x: own25(carrier.team) };
      s.phase = "dead";
      s.deadT = 0;
      s.clockRunning = false;
      return;
    }
    scoreSafety(s, (1 - carrier.team) as TeamId);
    return;
  }

  if (s.kind === "return") {
    const spot = clamp(carrier.x, FIELD_L + 1, FIELD_R - 1);
    say(s, "TACKLED", spotName(spot));
    sfx(s, "hit");
    s.shake = 0.35;
    s.queue = { t: "ball", team: carrier.team, x: spot };
    s.phase = "dead";
    s.deadT = 0;
    s.clockRunning = why !== "oob";
    return;
  }

  if (carrier.team !== s.poss) {
    const spot = clamp(carrier.x, FIELD_L + 1, FIELD_R - 1);
    say(s, s.thrown ? "INTERCEPTION" : "FUMBLE", spotName(spot));
    s.stats[carrier.team].takeaway += 1;
    sfx(s, "int");
    s.shake = 0.55;
    s.queue = { t: "ball", team: carrier.team, x: spot };
    s.phase = "dead";
    s.deadT = 0;
    s.clockRunning = why !== "oob";
    return;
  }

  if (s.twoPt) {
    say(s, "NO GOOD", "Stopped short");
    sfx(s, "hit");
    s.twoPt = false;
    s.queue = { t: "ko", team: (1 - s.poss) as TeamId };
    s.phase = "dead";
    s.deadT = 0;
    return;
  }

  const spot = clamp(carrier.x, FIELD_L + 1, FIELD_R - 1);
  const gain = s.dir * (spot - s.startLos);
  if (s.thrown && s.handed) s.stats[s.poss].pass += gain;
  else s.stats[s.poss].rush += gain;
  if (why === "sack") s.stats[(1 - s.poss) as TeamId].sack += 1;
  s.clockRunning = why !== "oob";
  s.down += 1;
  const need = s.toGo;
  if (gain >= need - 0.15) {
    s.down = 1;
    s.toGo = Math.min(10, Math.max(0.5, distGoal(s.poss, spot)));
    say(s, "FIRST DOWN", `${gain >= 0 ? "+" : ""}${gain.toFixed(0)} · ${spotName(spot)}`);
    sfx(s, "first");
    s.queue = { t: "spot", x: spot, first: true };
  } else if (s.down > 4) {
    say(s, "TURNOVER ON DOWNS", spotName(spot));
    sfx(s, "whistle");
    s.queue = { t: "ball", team: (1 - s.poss) as TeamId, x: spot };
  } else {
    s.toGo = Math.max(0.5, need - gain);
    const tag = why === "sack" ? "SACK" : why === "oob" ? "OUT OF BOUNDS" : gain < -0.4 ? "LOSS" : "TACKLED";
    say(s, tag, `${gain >= 0 ? "+" : ""}${gain.toFixed(0)} · ${downText(s)}`);
    sfx(s, why === "sack" ? "hit" : "tackle");
    s.shake = why === "sack" ? 0.5 : 0.32;
    s.queue = { t: "spot", x: spot };
  }
  s.phase = "dead";
  s.deadT = 0;
}

function steerUser(p: Player, pad: Pad, dir: number, dt: number, boost: number): void {
  let ax = pad.ax;
  let ay = pad.ay;
  const mag = Math.hypot(ax, ay);
  if (mag > 1) {
    ax /= mag;
    ay /= mag;
  }
  const sp = p.spd * boost * (p.diving > 0 ? 1.25 : 1) * (p.juke > 0 ? 1.18 : 1);
  const tvx = dir * ay * sp;
  const tvy = dir * ax * sp;
  const accel = 42;
  p.vx += clamp(tvx - p.vx, -accel * dt, accel * dt);
  p.vy += clamp(tvy - p.vy, -accel * dt, accel * dt);
  if (mag < 0.08 && p.diving <= 0) {
    p.vx *= Math.max(0, 1 - 10 * dt);
    p.vy *= Math.max(0, 1 - 10 * dt);
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
}

function follow(p: Player, dt: number, speedScale = 1): void {
  const wp = p.path[p.pi];
  if (!wp) {
    p.vx *= Math.max(0, 1 - 4 * dt);
    p.vy *= Math.max(0, 1 - 4 * dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    return;
  }
  const dx = wp.x - p.x;
  const dy = wp.y - p.y;
  const d = Math.hypot(dx, dy) || 0.0001;
  if (d < 0.55) {
    p.pi += 1;
    return;
  }
  const sp = p.spd * speedScale;
  p.vx = (dx / d) * sp;
  p.vy = (dy / d) * sp;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
}

function seek(p: Player, x: number, y: number, dt: number, scale: number): void {
  const dx = x - p.x;
  const dy = y - p.y;
  const d = Math.hypot(dx, dy) || 0.0001;
  const sp = p.spd * scale;
  p.vx = (dx / d) * sp;
  p.vy = (dy / d) * sp;
  if (d < sp * dt) {
    p.x = x;
    p.y = y;
  } else {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function nearest(s: GameState, p: Player, pred: (o: Player) => boolean): Player | undefined {
  let best: Player | undefined;
  let bd = 1e9;
  for (const o of s.players) {
    if (o.id === p.id || !pred(o)) continue;
    const d = dist(p.x, p.y, o.x, o.y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

function moveAI(s: GameState, p: Player, dt: number): void {
  const carrier = s.ball.carrier >= 0 ? s.players[s.ball.carrier] : undefined;
  const qb = P(s, s.poss, 0);
  const scale = p.shed > 0 ? 1.25 : 1;
  if (p.mode === "pursue" && carrier) {
    seek(p, carrier.x, carrier.y, dt, scale);
    return;
  }
  if (p.mode === "rush") {
    const shade = qb.y + (p.y - qb.y) * 0.25;
    seek(p, qb.x - s.dir * 0.4, shade, dt, (p.shed > 0 ? 1.3 : 1) * (s.sharp ? 1.05 : 1));
    return;
  }
  if (p.mode === "man" && p.man >= 0) {
    const rec = s.players[p.man];
    if (rec && !s.thrown) {
      const cushion = (defById(s.defId).press ? 0.45 : 1.7) * (s.sharp ? 0.85 : 1);
      seek(p, rec.x + s.dir * cushion, rec.y, dt, 1);
      return;
    }
  }
  if (p.mode === "spy" && !s.thrown) {
    seek(p, qb.x + s.dir * 3.5, qb.y, dt, 0.92);
    return;
  }
  if ((p.mode === "man" || p.mode === "zone" || p.mode === "spy") && s.thrown && s.ball.state === "air") {
    if (dist(p.x, p.y, s.ball.x, s.ball.y) < 22) {
      seek(p, s.ball.x, s.ball.y, dt, 1.05);
      return;
    }
  }
  if (p.mode === "zone" && !s.thrown) {
    seek(p, p.zx, p.zy, dt, dist(p.x, p.y, p.zx, p.zy) > 1.2 ? 1 : 0.35);
    return;
  }
  if (p.mode === "block") {
    const foe = nearest(s, p, (o) => o.team !== p.team && (o.mode === "rush" || o.mode === "pursue"));
    if (foe && dist(p.x, p.y, foe.x, foe.y) < 2.3) {
      const tx = foe.x - s.dir * 0.35;
      const ty = foe.y + (p.y - foe.y) * 0.4;
      seek(p, tx, ty, dt, 0.85);
      return;
    }
    follow(p, dt, 0.9);
    return;
  }
  if (carrier && p.id === carrier.id && p.team !== s.poss) {
    // returner already handled; defenders fall through
  }
  if (carrier && p.id === carrier.id && !s.human[p.team]) {
    const threat = nearest(s, p, (o) => o.team !== p.team);
    let lat = 0;
    if (threat && dist(p.x, p.y, threat.x, threat.y) < 4 && Math.sign(s.dir * (threat.x - p.x)) > 0) {
      lat = threat.y > p.y ? -1 : 1;
    }
    const sp = p.spd;
    p.vx = s.dir * sp * 0.98;
    p.vy = lat * sp * 0.55;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    return;
  }
  follow(p, dt, p.mode === "route" ? 1 : 0.85);
}

function blocked(s: GameState, p: Player): boolean {
  if (p.shed > 0) return false;
  for (const o of s.players) {
    if (o.team === p.team || o.mode !== "block") continue;
    if (dist(p.x, p.y, o.x, o.y) < 1.45) return true;
  }
  return false;
}

function throwBall(s: GameState, targetIdx: number): void {
  const qb = s.players[s.ball.carrier];
  if (!qb || qb.idx !== 0 || qb.team !== s.poss) return;
  if (s.thrown || s.ball.state !== "held") return;
  if (s.dir * (qb.x - s.los) > 0.4) return;
  const rec = P(s, s.poss, targetIdx);
  if (!rec || rec.ol) return;
  const pressure = s.players.filter(
    (p) => p.team !== s.poss && !p.ol && dist(p.x, p.y, qb.x, qb.y) < 2.6 && !blocked(s, p),
  ).length;
  let t = 0.45;
  let px = rec.x;
  let py = rec.y;
  for (let i = 0; i < 3; i++) {
    const pred = predict(rec, t, s.dir);
    px = pred.x;
    py = pred.y;
    t = clamp(Math.hypot(px - qb.x, py - qb.y) / 23, 0.38, 2.8);
  }
  const err = (rng(s) - 0.5) * (0.4 + pressure * 1.7) * (s.sharp ? 1.15 : 1);
  const dx = px - qb.x;
  const dy = py - qb.y;
  const d = Math.hypot(dx, dy) || 1;
  px += (-dy / d) * err;
  py += (dx / d) * err;
  const T = clamp(Math.hypot(px - qb.x, py - qb.y) / 23, 0.38, 2.8);
  s.ball.state = "air";
  s.ball.carrier = -1;
  s.ball.x = qb.x;
  s.ball.y = qb.y;
  s.ball.z = 2.15;
  s.ball.vx = (px - qb.x) / T;
  s.ball.vy = (py - qb.y) / T;
  const g = 30;
  s.ball.vz = (1.45 - 2.15 + 0.5 * g * T * T) / T;
  s.ball.flight = 0;
  s.ball.hang = T;
  s.thrown = true;
  sfx(s, "pass");
}

function predict(p: Player, t: number, dir: number): { x: number; y: number } {
  if (!p.path.length || p.pi >= p.path.length) return { x: p.x + p.vx * t, y: p.y + p.vy * t };
  let x = p.x;
  let y = p.y;
  let left = t;
  let pi = p.pi;
  const path = p.path;
  while (left > 0 && pi < path.length) {
    const wp = path[pi]!;
    const d = Math.hypot(wp.x - x, wp.y - y);
    const step = p.spd * left;
    if (d < 0.05) {
      pi += 1;
      continue;
    }
    if (step >= d) {
      left -= d / p.spd;
      x = wp.x;
      y = wp.y;
      pi += 1;
    } else {
      x += ((wp.x - x) / d) * step;
      y += ((wp.y - y) / d) * step;
      left = 0;
    }
  }
  if (left > 0) {
    x += dir * p.spd * left * 0.25;
  }
  return { x, y };
}

function bestHot(s: GameState): number {
  const play = offById(s.offId);
  let best = play.hot[0] ?? 2;
  let score = -999;
  for (const idx of play.hot) {
    const rec = P(s, s.poss, idx);
    if (!rec || rec.ol) continue;
    const pred = predict(rec, 0.6, s.dir);
    let sep = 30;
    for (const d of s.players) {
      if (d.team === s.poss) continue;
      sep = Math.min(sep, dist(pred.x, pred.y, d.x, d.y));
    }
    const depth = s.dir * (pred.x - s.los);
    const sc = sep + depth * 0.04;
    if (sc > score) {
      score = sc;
      best = idx;
    }
  }
  return best;
}

function catchBall(s: GameState): void {
  if (s.ball.state !== "air") return;
  if (s.ball.flight < Math.min(0.32, Math.max(0.2, s.ball.hang * 0.38))) return;
  let best = -1;
  let bd = 1.72;
  for (const p of s.players) {
    if (p.ol && p.team === s.poss) continue;
    const d = dist(p.x, p.y, s.ball.x, s.ball.y);
    if (d < bd) {
      bd = d;
      best = p.id;
    }
  }
  if (best < 0) {
    if (s.ball.z <= 0.15) whistleIncomplete(s);
    return;
  }
  const me = s.players[best]!;
  const opp = nearest(s, me, (o) => o.team !== me.team && !o.ol);
  const contest = opp && dist(opp.x, opp.y, s.ball.x, s.ball.y) < 1.55;
  if (contest && opp) {
    if (rng(s) < 0.22) {
      whistleIncomplete(s);
      return;
    }
    const defCloser = dist(opp.x, opp.y, s.ball.x, s.ball.y) + 0.05 < bd;
    const offWins = rng(s) < (defCloser ? 0.42 : 0.66);
    const winner = me.team === s.poss ? (offWins ? me : opp) : offWins ? opp : me;
    secure(s, winner);
    return;
  }
  if (s.ball.z <= 2.5) secure(s, me);
}

function secure(s: GameState, p: Player): void {
  s.ball.state = "held";
  s.ball.carrier = p.id;
  s.ball.z = 1.3;
  s.ball.vx = 0;
  s.ball.vy = 0;
  s.ctrl[p.team] = p.id;
  if (p.team === s.poss) {
    s.handed = true;
    say(s, "CAUGHT", p.name);
    sfx(s, "catch");
    for (const o of s.players) {
      if (o.id === p.id) o.mode = "route";
      else if (o.team === s.poss) o.mode = "block";
      else o.mode = "pursue";
    }
  } else {
    say(s, "PICKED", p.name);
    sfx(s, "int");
    s.shake = 0.4;
    for (const o of s.players) {
      if (o.id === p.id) o.mode = "route";
      else if (o.team === p.team) o.mode = "block";
      else o.mode = "pursue";
    }
  }
}

function tickLive(s: GameState, dt: number, pads: [Pad, Pad]): void {
  s.liveT += dt;
  if (!s.freeze) {
    if ((s.q === 2 || s.q === 4) && s.clock > 120 && s.clock - dt * 4 <= 120) {
      s.clock = 120;
      s.freeze = true;
      s.clockRunning = false;
      say(s, "TWO-MINUTE WARNING", "");
      sfx(s, "whistle");
    } else if (s.clockRunning) {
      s.clock = Math.max(0, s.clock - dt * 4);
    }
  }
  s.shake = Math.max(0, s.shake - dt * 1.4);

  for (const team of [0, 1] as const) {
    if (pads[team].switch && team !== s.poss && s.human[team]) cycleDef(s, team);
  }

  const off = s.kind === "scrimmage" ? offById(s.offId) : undefined;
  if (off && off.group === "run" && !s.handed && s.liveT >= off.handoffAt && off.handoffAt < 20) {
    const rb = P(s, s.poss, 1);
    s.ball.carrier = rb.id;
    s.handed = true;
    s.ctrl[s.poss] = rb.id;
    sfx(s, "snap");
  }

  for (const p of s.players) {
    p.juke = Math.max(0, p.juke - dt);
    p.jukeCd = Math.max(0, p.jukeCd - dt);
    p.diving = Math.max(0, p.diving - dt);
    p.shed = Math.max(0, p.shed - dt);
    if (p.down) {
      p.vx = p.vy = 0;
      continue;
    }
    const human = s.human[p.team] && p.id === s.ctrl[p.team];
    const pad = pads[p.team];
    const steering = human && (Math.abs(pad.ax) + Math.abs(pad.ay) > 0.16 || p.diving > 0);
    if (human && pad.juke && p.jukeCd <= 0 && s.ball.carrier === p.id) {
      p.juke = 0.26;
      p.jukeCd = 1.2;
      p.vy += s.dir * (pad.ax === 0 ? (rng(s) < 0.5 ? -1 : 1) : Math.sign(pad.ax)) * p.spd * 0.8;
      sfx(s, "juke");
    }
    if (human && pad.dive && s.ball.carrier === p.id && p.diving <= 0) {
      p.diving = 0.34;
      sfx(s, "hit");
    }
    if (steering) steerUser(p, pad, s.dir, dt, p.team === s.poss ? 1 : 1.04);
    else moveAI(s, p, dt);

    if (blocked(s, p) && (p.mode === "rush" || p.mode === "pursue")) {
      p.blockT = (p.blockT ?? 0) + dt;
      p.vx *= 0.82;
      p.vy *= 0.82;
      p.x += s.dir * 1.6 * dt;
      if ((p.blockT ?? 0) > (s.sharp ? 1.25 : 1.55)) {
        p.shed = 0.4;
        p.blockT = 0;
      }
    } else p.blockT = 0;
  }

  // Keep bodies from stacking into one pixel.
  for (let i = 0; i < s.players.length; i++) {
    for (let j = i + 1; j < s.players.length; j++) {
      const a = s.players[i]!;
      const b = s.players[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.0001;
      if (d < 0.92) {
        const push = (0.92 - d) * 0.5;
        a.x -= (dx / d) * push;
        a.y -= (dy / d) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d) * push;
      }
    }
  }

  for (const p of s.players) p.y = clamp(p.y, -28.5, 28.5);

  const carrier = s.ball.carrier >= 0 ? s.players[s.ball.carrier] : undefined;
  if (s.ball.state === "held" && carrier) {
    s.ball.x = carrier.x + carrier.vx * 0.02;
    s.ball.y = carrier.y;
    s.ball.z = 1.25;
    if ((carrier.team === 0 && carrier.x >= FIELD_R) || (carrier.team === 1 && carrier.x <= FIELD_L)) {
      scoreTD(s, carrier.team);
      return;
    }
    if (Math.abs(carrier.y) > SIDELINE) {
      carrier.y = Math.sign(carrier.y) * SIDELINE;
      whistleDown(s, "oob");
      return;
    }
    if (carrier.diving > 0 && carrier.diving < 0.04) {
      whistleDown(s, "dive");
      return;
    }
    let contact = 0;
    for (const d of s.players) {
      if (d.team === carrier.team || d.down) continue;
      if (blocked(s, d)) {
        d.grip = 0;
        continue;
      }
      const dd = dist(d.x, d.y, carrier.x, carrier.y);
      if (dd < 1.38) {
        contact += 1;
        d.grip += dt * (s.sharp && !s.human[carrier.team] ? 1.2 : 1);
        const need = contact >= 2 ? 0.12 : 0.26;
        if (d.grip > need && carrier.juke <= 0) {
          whistleDown(s, carrier.idx === 0 && carrier.team === s.poss && !s.handed ? "sack" : "tackle");
          return;
        }
        if (carrier.juke > 0 && d.grip > 0.05) {
          d.grip = 0;
          d.shed = Math.max(d.shed, 0.15);
        }
      } else d.grip = Math.max(0, d.grip - dt * 0.8);
    }
  } else if (s.ball.state === "air") {
    const g = 30;
    s.ball.flight += dt;
    s.ball.x += s.ball.vx * dt;
    s.ball.y += s.ball.vy * dt;
    s.ball.z += s.ball.vz * dt;
    s.ball.vz -= g * dt;
    if (Math.abs(s.ball.y) > SIDELINE + 2) {
      whistleIncomplete(s);
      return;
    }
    catchBall(s);
    if (s.phase !== "live") return;
    if (s.ball.z <= 0 && s.ball.state === "air") whistleIncomplete(s);
  }

  if (s.phase !== "live") return;

  // Human / CPU throw decisions.
  if (off && off.group === "pass" && !s.thrown && s.ball.state === "held") {
    const qb = P(s, s.poss, 0);
    if (s.ball.carrier === qb.id) {
      const pad = pads[s.poss];
      if (s.human[s.poss] && pad.throwTo !== null) throwBall(s, pad.throwTo);
      else if (!s.human[s.poss] && s.liveT >= off.throwAt) throwBall(s, bestHot(s));
      else if (s.human[s.poss] && s.liveT > 3.3 && Math.abs(pad.ax) + Math.abs(pad.ay) < 0.2) {
        throwBall(s, bestHot(s));
      }
    }
  }

  if (s.liveT > 9.5 && s.phase === "live") {
    if (s.ball.state === "air") whistleIncomplete(s);
    else whistleDown(s, "tackle");
  }
}

function cycleDef(s: GameState, team: TeamId): void {
  const order = [4, 2, 3, 1, 5, 0, 10, 6, 9]
    .map((i) => P(s, team, i))
    .sort((a, b) => dist(a.x, a.y, s.ball.x, s.ball.y) - dist(b.x, b.y, s.ball.x, s.ball.y));
  const cur = s.ctrl[team];
  const at = Math.max(0, order.findIndex((p) => p.id === cur));
  s.ctrl[team] = order[(at + 1) % order.length]!.id;
}

function tickCall(s: GameState, dt: number): void {
  s.playClock = Math.max(0, s.playClock - dt);
  s.shake = Math.max(0, s.shake - dt);
  if (s.playClock <= 0) {
    for (const team of [0, 1] as const) {
      if (!s.chosen[team]) {
        if (team === s.poss) {
          s.los = clamp(s.los - s.dir * 5, FIELD_L + 1, FIELD_R - 1);
          say(s, "DELAY OF GAME", "5 yards");
          sfx(s, "whistle");
        }
        s.chosen[team] = cpuPick(s, team);
      }
    }
    maybePresnap(s);
  }
}

function tickPresnap(s: GameState, dt: number, pads: [Pad, Pad]): void {
  s.liveT += dt;
  const offenseHuman = s.human[s.poss];
  if ((offenseHuman && pads[s.poss].snap) || (!offenseHuman && s.liveT > 1.15) || s.liveT > 7) {
    if (s.clockRunning && !s.freeze) s.clock = Math.max(0, s.clock - 16);
    s.freeze = false;
    s.clockRunning = true;
    s.phase = "live";
    s.liveT = 0;
    sfx(s, "snap");
    say(s, "", "");
  }
}

function tickDead(s: GameState, dt: number, pads: [Pad, Pad]): void {
  s.deadT += dt;
  s.shake = Math.max(0, s.shake - dt * 1.2);
  const skip = pads[0].snap || pads[1].snap || pads[s.myTeam].snap;
  if (s.deadT > 1.55 || (skip && s.deadT > 0.35)) applyQueue(s);
}

function tickFg(s: GameState, dt: number): void {
  if (!s.fg) return;
  s.fg.t += dt;
  if (!s.human[s.fg.team] && s.fg.t > 0.65) {
    const sweet = s.fg.dist < 30 ? 0.3 : s.fg.dist < 40 ? 0.2 : s.fg.dist < 50 ? 0.12 : 0.07;
    const acc = (rng(s) - 0.5) * sweet * (s.sharp ? 2.3 : 1.5);
    resolveKick(s, acc);
  }
  if (s.fg && s.fg.t > 8 && s.human[s.fg.team]) resolveKick(s, 1);
}

export function step(s: GameState, dt: number, pads: [Pad, Pad]): void {
  if (s.paused || !s.simLocal) return;
  if (s.phase === "menu" || s.phase === "lobby" || s.phase === "final" || s.phase === "pat") return;
  if (s.phase === "call") return tickCall(s, dt);
  if (s.phase === "presnap") return tickPresnap(s, dt, pads);
  if (s.phase === "dead") return tickDead(s, dt, pads);
  if (s.phase === "fg") return tickFg(s, dt);
  if (s.phase === "live") tickLive(s, dt, pads);
}

export function takeOverLocal(s: GameState): void {
  s.online = false;
  s.simLocal = true;
  s.human = [s.myTeam === 0, s.myTeam === 1];
  if (s.phase === "lobby") beginSolo(s);
}

export interface Snap {
  k: "st";
  n: number;
  phase: GameState["phase"];
  q: number;
  clock: number;
  pc: number;
  down: number;
  toGo: number;
  los: number;
  dir: 1 | -1;
  poss: TeamId;
  score: [number, number];
  banner: string;
  sub: string;
  ctrl: [number, number];
  px: number[];
  py: number[];
  pvx: number[];
  pvy: number[];
  ball: [number, number, number, number, number];
  sfxN: number;
  sfx: string;
  log: string[];
  stats: [Stats, Stats];
  fg: Kick | null;
  endNote: string;
  play: string;
  def: string;
  kind: Kind;
  thrown: boolean;
  two: boolean;
}

const qn = (n: number) => Math.round(n * 100) / 100;

export function packSnap(s: GameState): Snap {
  s.snapN += 1;
  return {
    k: "st",
    n: s.snapN,
    phase: s.phase,
    q: s.q,
    clock: qn(s.clock),
    pc: qn(s.playClock),
    down: s.down,
    toGo: qn(s.toGo),
    los: qn(s.los),
    dir: s.dir,
    poss: s.poss,
    score: [...s.score],
    banner: s.banner,
    sub: s.sub,
    ctrl: [...s.ctrl],
    px: s.players.map((p) => qn(p.x)),
    py: s.players.map((p) => qn(p.y)),
    pvx: s.players.map((p) => qn(p.vx)),
    pvy: s.players.map((p) => qn(p.vy)),
    ball: [qn(s.ball.x), qn(s.ball.y), qn(s.ball.z), s.ball.carrier, s.ball.state === "air" ? 1 : s.ball.state === "dead" ? 2 : 0],
    sfxN: s.sfxN,
    sfx: s.sfx,
    log: s.log.slice(0, 5),
    stats: s.stats,
    fg: s.fg,
    endNote: s.endNote,
    play: s.offId,
    def: s.defId,
    kind: s.kind,
    thrown: s.thrown,
    two: s.twoPt,
  };
}

export function applySnap(s: GameState, snap: Snap): void {
  if (snap.n < s.lastN) return;
  const teleport = !s.seen || snap.phase !== s.phase;
  s.lastN = snap.n;
  s.seen = true;
  s.phase = snap.phase;
  s.q = snap.q;
  s.clock = snap.clock;
  s.playClock = snap.pc;
  s.down = snap.down;
  s.toGo = snap.toGo;
  s.los = snap.los;
  s.dir = snap.dir;
  s.poss = snap.poss;
  s.score = snap.score;
  s.banner = snap.banner;
  s.sub = snap.sub;
  s.ctrl = snap.ctrl;
  s.sfxN = snap.sfxN;
  s.sfx = snap.sfx;
  s.log = snap.log;
  s.stats = snap.stats;
  s.fg = snap.fg;
  s.endNote = snap.endNote;
  s.offId = snap.play;
  s.defId = snap.def;
  s.kind = snap.kind;
  s.thrown = snap.thrown;
  s.twoPt = snap.two;
  s.ball.tx = snap.ball[0];
  s.ball.ty = snap.ball[1];
  s.ball.tz = snap.ball[2];
  s.ball.carrier = snap.ball[3];
  s.ball.state = snap.ball[4] === 1 ? "air" : snap.ball[4] === 2 ? "dead" : "held";
  for (let i = 0; i < 22; i++) {
    const p = s.players[i]!;
    p.tx = snap.px[i] ?? p.x;
    p.ty = snap.py[i] ?? p.y;
    p.vx = snap.pvx[i] ?? 0;
    p.vy = snap.pvy[i] ?? 0;
    if (teleport) {
      p.x = p.tx;
      p.y = p.ty;
    }
  }
  if (teleport) {
    s.ball.x = s.ball.tx;
    s.ball.y = s.ball.ty;
    s.ball.z = s.ball.tz;
  }
}

export function smoothGuest(s: GameState, dt: number): void {
  const k = Math.min(1, dt * 12);
  for (const p of s.players) {
    p.x += (p.tx - p.x) * k;
    p.y += (p.ty - p.y) * k;
  }
  s.ball.x += (s.ball.tx - s.ball.x) * k;
  s.ball.y += (s.ball.ty - s.ball.y) * k;
  s.ball.z += (s.ball.tz - s.ball.z) * k;
}

export function openTarget(s: GameState): number {
  return bestHot(s);
}

export function clockLabel(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
