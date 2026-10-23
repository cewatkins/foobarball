import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { Copy, Link2, Pause, Play, Shield, Volume2, VolumeX } from "lucide-react";
import { useP2PRoom } from "@/lib/multiplayer/use-p2p-room";
import type { PeerInfo } from "@/lib/multiplayer";
import { DEFENSE, KICKS, OFFENSE, offById, defById, suggestDef, suggestOff } from "./plays";
import { createRenderer } from "./render";
import { isMuted, playSfx, resumeAudio, setMuted, unlockAudio } from "./audio";
import {
  applySnap,
  armOnline,
  beginSolo,
  choosePlay,
  clockLabel,
  createMatch,
  downText,
  hostKickoff,
  neutralPad,
  openTarget,
  packSnap,
  resolveKick,
  smoothGuest,
  spotName,
  startKick,
  startTwo,
  step,
  takeOverLocal,
  viewYaw,
  type Snap,
} from "./sim";
import type { GameState, Pad, Phase, TeamId } from "./types";

interface Hud {
  phase: Phase;
  q: number;
  clock: string;
  pc: number;
  down: string;
  spot: string;
  score: [number, number];
  poss: TeamId;
  banner: string;
  sub: string;
  log: string[];
  fgDist: number;
  fgKind: "fg" | "xp" | null;
  fgTeam: TeamId;
  endNote: string;
  myTeam: TeamId;
  offId: string;
  defId: string;
  thrown: boolean;
  two: boolean;
  downN: number;
  toGo: number;
  losPct: number;
  firstPct: number;
  carrierIsQb: boolean;
  group: "run" | "pass" | "return";
  online: boolean;
  ready: [boolean, boolean];
}

function readHud(s: GameState): Hud {
  const fromLeft = s.los - 10;
  const firstX = s.los + s.dir * s.toGo;
  const carrier = s.ball.carrier >= 0 ? s.players[s.ball.carrier] : undefined;
  const group =
    s.kind === "return" ? "return" : s.offId ? (offById(s.offId).group as "run" | "pass") : "run";
  return {
    phase: s.phase,
    q: s.q,
    clock: clockLabel(s.clock),
    pc: Math.ceil(s.playClock),
    down: downText(s),
    spot: spotName(s.los),
    score: [s.score[0], s.score[1]],
    poss: s.poss,
    banner: s.banner,
    sub: s.sub,
    log: s.log.slice(0, 4),
    fgDist: s.fg?.dist ?? 0,
    fgKind: s.fg?.kind ?? null,
    fgTeam: s.fg?.team ?? 0,
    endNote: s.endNote,
    myTeam: s.myTeam,
    offId: s.offId,
    defId: s.defId,
    thrown: s.thrown,
    two: s.twoPt,
    downN: s.down,
    toGo: s.toGo,
    losPct: Math.max(0, Math.min(100, fromLeft)),
    firstPct: Math.max(0, Math.min(100, firstX - 10)),
    carrierIsQb: !!carrier && carrier.idx === 0 && carrier.team === s.poss,
    group,
    online: s.online,
    ready: [s.chosen[0] != null, s.chosen[1] != null],
  };
}

interface Edges {
  snap: boolean;
  juke: boolean;
  dive: boolean;
  switch: boolean;
  throwTo: number | null;
}

const emptyEdges = (): Edges => ({ snap: false, juke: false, dive: false, switch: false, throwTo: null });

export function Nightline() {
  const sim = useRef<GameState>(createMatch());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keys = useRef(new Set<string>());
  const forced = useRef<Set<string> | null>(null);
  const edges = useRef<Edges>(emptyEdges());
  const touch = useRef({ ax: 0, ay: 0 });
  const remote = useRef<Pad>(neutralPad());
  const net = useRef<{ broadcast: (d: unknown) => void; send: (d: unknown, id?: string) => void } | null>(null);
  const lastSfx = useRef(0);
  const phaseHold = useRef<Phase>("menu");
  const flushNet = useRef(false);
  const [hud, setHud] = useState<Hud>(() => readHud(sim.current));
  const [screen, setScreen] = useState<"menu" | "link" | "play" | "booth">("menu");
  const [sharp, setSharp] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMute] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [booth, setBooth] = useState<{ code: string; home: boolean } | null>(null);
  const [linkLost, setLinkLost] = useState(false);
  const [linkNote, setLinkNote] = useState("");
  const [rematchAsk, setRematchAsk] = useState(false);
  const [asked, setAsked] = useState(false);
  const homeRef = useRef(false);

  const push = useCallback(() => setHud(readHud(sim.current)), []);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      keys.current.add(e.code);
      const s = sim.current;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      if (e.code === "Escape") {
        if (s.phase !== "menu" && s.phase !== "lobby") {
          s.paused = !s.paused;
          setPaused(s.paused);
          flushNet.current = true;
          if (s.online && s.myTeam === 1) net.current?.send({ k: "pause", on: s.paused });
        }
        return;
      }
      if (e.code === "Enter" || (e.code === "Space" && (s.phase === "presnap" || s.phase === "dead"))) {
        edges.current.snap = true;
      } else if (e.code === "Space") {
        if (s.phase === "live" && s.myTeam === s.poss && !s.thrown && s.kind === "scrimmage" && offById(s.offId).group === "pass" && s.ball.carrier === s.poss * 11) {
          edges.current.throwTo = openTarget(s);
        } else edges.current.juke = true;
      } else if (e.code === "KeyJ" || e.code === "ShiftLeft" || e.code === "ShiftRight") edges.current.juke = true;
      else if (e.code === "KeyF") edges.current.dive = true;
      else if (e.code === "KeyQ" || e.code === "KeyC") edges.current.switch = true;
      else if (e.code >= "Digit1" && e.code <= "Digit5" && s.phase === "live" && s.myTeam === s.poss) {
        const hot = offById(s.offId).hot;
        const idx = hot[Number(e.code.slice(5)) - 1];
        if (idx !== undefined) edges.current.throwTo = idx;
      }
      if (e.code === "KeyM") {
        const next = !isMuted();
        setMuted(next);
        setMute(next);
      }
    };
    const onUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    const onBlur = () => keys.current.clear();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    const onVis = () => {
      if (document.visibilityState === "visible") resumeAudio();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = createRenderer(canvas);
    let last = performance.now();
    let acc = 0;
    let hudAcc = 0;
    let sendAcc = 0;
    let raf = 0;
    let relAcc = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      acc += dt;
      hudAcc += dt;
      sendAcc += dt;
      relAcc += dt;
      const s = sim.current;
      let sentGuest = false;
      let first = true;
      let steps = 0;
      while (acc >= 1 / 60 && steps < 5) {
        const pad = readPad(keys.current, forced.current, touch.current, edges.current, first);
        const pads: [Pad, Pad] = [neutralPad(), neutralPad()];
        pads[s.myTeam] = pad;
        if (s.online && s.myTeam === 0) {
          pads[1] = {
            ax: remote.current.ax,
            ay: remote.current.ay,
            snap: first && remote.current.snap,
            juke: first && remote.current.juke,
            dive: first && remote.current.dive,
            switch: first && remote.current.switch,
            throwTo: first ? remote.current.throwTo : null,
          };
        }
        if (s.simLocal) step(s, 1 / 60, pads);
        else if (first && !sentGuest) {
          const e = pad;
          if (net.current && (e.snap || e.juke || e.dive || e.switch || e.throwTo !== null)) {
            net.current.send({
              k: "edge",
              snap: e.snap,
              juke: e.juke,
              dive: e.dive,
              switch: e.switch,
              throwTo: e.throwTo,
            });
          }
          sentGuest = true;
        }
        first = false;
        acc -= 1 / 60;
        steps += 1;
      }
      if (steps > 0 && s.online && s.myTeam === 0) {
        remote.current.snap = false;
        remote.current.juke = false;
        remote.current.dive = false;
        remote.current.switch = false;
        remote.current.throwTo = null;
      }
      if (!s.simLocal) smoothGuest(s, dt);
      if (s.simLocal && s.sfxN !== lastSfx.current) {
        lastSfx.current = s.sfxN;
        playSfx(s.sfx);
        flushNet.current = true;
      }
      if (s.online && s.simLocal && (flushNet.current || s.phase !== phaseHold.current)) {
        phaseHold.current = s.phase;
        flushNet.current = false;
        sendAcc = 1;
        relAcc = 1;
      }
      draw(s, dt, { team: s.myTeam });
      const link = net.current;
      if (s.online && link && s.phase !== "menu" && s.phase !== "lobby") {
        if (s.simLocal) {
          const fast = sendAcc > (s.phase === "live" ? 0.05 : 0.12);
          const sure = relAcc > 0.25;
          if (fast || sure) {
            const snap = packSnap(s);
            if (fast) {
              link.broadcast(snap);
              sendAcc = 0;
            }
            if (sure) {
              link.send(snap);
              relAcc = 0;
            }
          }
        } else if (sendAcc > 0.05) {
          const pad = readPad(keys.current, forced.current, touch.current, emptyEdges(), false);
          link.broadcast({ k: "in", ax: pad.ax, ay: pad.ay });
          sendAcc = 0;
        }
      }
      if (hudAcc > 0.12) {
        hudAcc = 0;
        setHud(readHud(s));
      }
      raf = requestAnimationFrame(loop);
    };
    window.__controlsTest = {
      getYaw: () => {
        const s = sim.current;
        const p = s.players[s.ctrl[s.myTeam]];
        if (!p || s.phase !== "live") return 0;
        return viewYaw(s.dir, p.vx, p.vy);
      },
      getSpeed: () => {
        const s = sim.current;
        const p = s.players[s.ctrl[s.myTeam]];
        if (!p || s.phase !== "live") return 0;
        return Math.hypot(p.vx, p.vy);
      },
      setKeys: (codes: string[]) => {
        forced.current = codes.length ? new Set(codes) : null;
      },
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      delete window.__controlsTest;
    };
  }, []);

  function fireEdge(partial: Partial<Edges>) {
    edges.current = { ...edges.current, ...partial };
  }

  function startSolo() {
    unlockAudio();
    beginSolo(sim.current, sharp);
    setScreen("play");
    setPaused(false);
    setLinkLost(false);
    push();
  }

  function call(id: string) {
    const s = sim.current;
    if (s.phase !== "call") return;
    setPicked(id);
    if (s.online && s.myTeam === 1) net.current?.send({ k: "call", id });
    else {
      choosePlay(s, s.myTeam, id);
      flushNet.current = true;
    }
    push();
  }

  function onKickMeter(acc: number) {
    playSfx("kick");
    const s = sim.current;
    if (s.online && s.myTeam === 1) net.current?.send({ k: "kick", acc });
    else {
      resolveKick(s, acc);
      flushNet.current = true;
    }
    push();
  }

  function quit() {
    const s = sim.current;
    s.phase = "menu";
    s.online = false;
    s.paused = false;
    s.simLocal = true;
    setBooth(null);
    setScreen("menu");
    setPaused(false);
    setLinkLost(false);
    setRematchAsk(false);
    setAsked(false);
    setLinkNote("");
    push();
  }

  const onNet = useCallback((data: unknown) => {
    const msg = data as {
      k?: string;
      ax?: number;
      ay?: number;
      id?: string;
      acc?: number;
      snap?: boolean;
      juke?: boolean;
      dive?: boolean;
      switch?: boolean;
      throwTo?: number | null;
      mode?: string;
      on?: boolean;
    };
    const s = sim.current;
    if (!homeRef.current && msg.k === "st") {
      const wasPaused = s.paused;
      const before = s.sfxN;
      applySnap(s, data as Snap);
      if (s.sfxN !== before) playSfx(s.sfx);
      if (s.paused !== wasPaused) setPaused(s.paused);
      return;
    }
    if (homeRef.current && msg.k === "in") {
      remote.current.ax = msg.ax ?? 0;
      remote.current.ay = msg.ay ?? 0;
    } else if (homeRef.current && msg.k === "edge") {
      remote.current.snap = !!msg.snap;
      remote.current.juke = !!msg.juke;
      remote.current.dive = !!msg.dive;
      remote.current.switch = !!msg.switch;
      remote.current.throwTo = msg.throwTo ?? null;
    } else if (homeRef.current && msg.k === "call" && msg.id) {
      choosePlay(s, 1, msg.id);
      flushNet.current = true;
    } else if (homeRef.current && msg.k === "kick" && typeof msg.acc === "number") {
      playSfx("kick");
      resolveKick(s, msg.acc);
      flushNet.current = true;
    } else if (homeRef.current && msg.k === "pat") {
      if (msg.mode === "two") {
        s.patTeam = 1;
        startTwo(s);
      } else {
        startKick(s, 1, "xp");
      }
      flushNet.current = true;
    } else if (homeRef.current && msg.k === "pause") {
      s.paused = !!msg.on;
      setPaused(s.paused);
      flushNet.current = true;
    } else if (homeRef.current && msg.k === "rematch") {
      setRematchAsk(true);
    }
  }, []);

  useEffect(() => {
    if (hud.phase !== "call") setPicked(null);
  }, [hud.phase]);

  // edges for the guest are flushed inside the sim loop
  useEffect(() => {
    return () => {
      net.current = null;
    };
  }, []);

  const offense = hud.poss === hud.myTeam;
  const showMeter = hud.phase === "fg" && hud.fgKind && hud.fgTeam === hud.myTeam;
  const targets =
    hud.phase === "live" && offense && !hud.thrown && hud.group === "pass" && hud.carrierIsQb
      ? offById(hud.offId).hot.slice(0, 5)
      : [];

  return (
    <main className="relative h-dvh overflow-hidden bg-bg text-fg select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />
      <div className="relative z-10 flex h-full flex-col">
        {hud.phase !== "menu" && (
          <Scorebug
            hud={hud}
            muted={muted}
            onMute={() => {
              const next = !muted;
              setMuted(next);
              setMute(next);
            }}
            onPause={() => {
              sim.current.paused = true;
              setPaused(true);
              flushNet.current = true;
              if (sim.current.online && sim.current.myTeam === 1) net.current?.send({ k: "pause", on: true });
            }}
          />
        )}
        {booth && hud.phase !== "menu" && hud.phase !== "lobby" && linkNote && (
          <p className="pointer-events-none px-3 text-xs text-muted">{linkNote}</p>
        )}

        {hud.banner && hud.phase !== "menu" && hud.phase !== "call" && (
          <div className="pointer-events-none mx-auto mt-3 max-w-lg px-4 text-center">
            <p className="font-display text-4xl leading-none tracking-wide text-fg drop-shadow-sm">{hud.banner}</p>
            {hud.sub && <p className="mt-1 text-sm text-muted">{hud.sub}</p>}
          </div>
        )}

        <div className="flex-1" />

        {screen === "menu" && hud.phase === "menu" && (
          <Menu
            sharp={sharp}
            onSharp={() => setSharp((v) => !v)}
            onStart={startSolo}
            onLink={() => setScreen("link")}
          />
        )}

        {screen === "link" && (
          <LinkPanel
            onBack={() => setScreen("menu")}
            onHost={() => {
              unlockAudio();
              const code = boothCode();
              homeRef.current = true;
              armOnline(sim.current, 0, true);
              setBooth({ code, home: true });
              setScreen("booth");
              setLinkLost(false);
              setRematchAsk(false);
              setAsked(false);
              push();
            }}
            onJoin={(code) => {
              unlockAudio();
              homeRef.current = false;
              armOnline(sim.current, 1, false);
              setBooth({ code, home: false });
              setScreen("booth");
              setLinkLost(false);
              setRematchAsk(false);
              setAsked(false);
              push();
            }}
          />
        )}

        {screen === "booth" && booth && (
          <Online
            room={booth.code}
            home={booth.home}
            hud={hud}
            netRef={net}
            onMessage={onNet}
            onKick={() => {
              const s = sim.current;
              hostKickoff(s);
              const snap = packSnap(s);
              net.current?.send(snap);
              net.current?.broadcast(snap);
              flushNet.current = true;
              push();
            }}
            onLost={() => setLinkLost(true)}
            onLink={setLinkNote}
          />
        )}

        {hud.phase === "call" && (
          <CallSheet offense={offense} hud={hud} picked={picked} onPick={call} />
        )}

        {hud.phase === "presnap" && offense && (
          <div className="mx-auto mb-4 flex w-full max-w-md flex-col items-center gap-2 px-4">
            <p className="text-sm text-muted">{offById(hud.offId).name} · {offById(hud.offId).formation}</p>
            <button type="button" className="h-14 w-full rounded-xl bg-aces text-lg font-display tracking-wide text-bg" onClick={() => fireEdge({ snap: true })}>
              Snap
            </button>
          </div>
        )}

        {hud.phase === "presnap" && !offense && (
          <div className="mx-auto mb-4 w-full max-w-md px-4 text-center">
            <p className="font-display text-xl text-kings">{defById(hud.defId).name}</p>
            <p className="text-sm text-muted">They have the ball. You take one defender.</p>
          </div>
        )}

        {hud.phase === "live" && (
          <LiveControls
            targets={targets}
            poss={hud.poss}
            myTeam={hud.myTeam}
            onThrow={(idx) => fireEdge({ throwTo: idx })}
            onJuke={() => fireEdge({ juke: true })}
            onDive={() => fireEdge({ dive: true })}
            onSwitch={() => fireEdge({ switch: true })}
            onStick={(ax, ay) => {
              touch.current.ax = ax;
              touch.current.ay = ay;
            }}
          />
        )}

        {hud.phase === "dead" && (
          <div className="mx-auto mb-6 w-full max-w-md px-4">
            <button type="button" className="h-12 w-full rounded-xl border border-line bg-surface text-fg" onClick={() => fireEdge({ snap: true })}>
              Next
            </button>
          </div>
        )}

        {hud.phase === "pat" && hud.myTeam === hud.poss && (
          <div className="mx-auto mb-6 grid w-full max-w-md grid-cols-2 gap-2 px-4">
            <button
              type="button"
              className="h-14 rounded-xl bg-aces font-display text-lg text-bg"
              onClick={() => {
                if (sim.current.online && sim.current.myTeam === 1) net.current?.send({ k: "pat", mode: "xp" });
                else {
                  startKick(sim.current, hud.myTeam, "xp");
                  push();
                }
              }}
            >
              Kick XP
            </button>
            <button
              type="button"
              className="h-14 rounded-xl border border-kings font-display text-lg text-kings"
              onClick={() => {
                if (sim.current.online && sim.current.myTeam === 1) net.current?.send({ k: "pat", mode: "two" });
                else {
                  startTwo(sim.current);
                  push();
                }
              }}
            >
              Go for 2
            </button>
          </div>
        )}

        {showMeter && (
          <Meter dist={hud.fgDist} label={hud.fgKind === "xp" ? "Extra point" : `${hud.fgDist} yards`} onKick={onKickMeter} />
        )}

        {hud.phase === "fg" && !showMeter && (
          <p className="mb-8 text-center text-sm text-muted">The kick is up…</p>
        )}

        {hud.phase === "final" && (
          <Final
            hud={hud}
            ask={rematchAsk}
            asked={asked}
            onAgain={() => {
              if (sim.current.online && homeRef.current) {
                setRematchAsk(false);
                setAsked(false);
                hostKickoff(sim.current);
                flushNet.current = true;
                push();
              } else if (sim.current.online) {
                net.current?.send({ k: "rematch" });
                setAsked(true);
              } else startSolo();
            }}
            onQuit={quit}
          />
        )}

        {linkLost && (
          <div className="absolute inset-x-0 bottom-0 z-20 mx-auto mb-6 w-full max-w-md px-4">
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="font-display text-xl">Link dropped</p>
              <p className="mt-1 text-sm text-muted">Their booth closed. You can finish this one against the CPU.</p>
              <button type="button" className="mt-3 h-11 w-full rounded-lg bg-aces text-bg" onClick={() => { takeOverLocal(sim.current); setLinkLost(false); setScreen("play"); push(); }}>
                Finish vs CPU
              </button>
            </div>
          </div>
        )}

        {paused && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg/80 px-4">
            <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5">
              <h2 className="font-display text-3xl">Paused</h2>
              <p className="mt-1 text-sm text-muted">{hud.online ? "Held for both of you." : "Take a breath."}</p>
              <div className="mt-4 flex gap-2">
                <button type="button" className="h-12 flex-1 rounded-xl bg-aces font-display text-lg text-bg" onClick={() => {
                  sim.current.paused = false;
                  setPaused(false);
                  flushNet.current = true;
                  if (sim.current.online && sim.current.myTeam === 1) net.current?.send({ k: "pause", on: false });
                }}>
                  Resume
                </button>
                <button type="button" className="h-12 flex-1 rounded-xl border border-line" onClick={quit}>
                  Quit
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function readPad(
  keys: Set<string>,
  forced: Set<string> | null,
  touch: { ax: number; ay: number },
  edges: Edges,
  takeEdges: boolean,
): Pad {
  const src = forced ?? keys;
  let ax = forced ? 0 : touch.ax;
  let ay = forced ? 0 : touch.ay;
  if (src.has("KeyA") || src.has("ArrowLeft")) ax -= 1;
  if (src.has("KeyD") || src.has("ArrowRight")) ax += 1;
  if (src.has("KeyW") || src.has("ArrowUp")) ay += 1;
  if (src.has("KeyS") || src.has("ArrowDown")) ay -= 1;
  const pad: Pad = {
    ax,
    ay,
    snap: takeEdges ? edges.snap : false,
    juke: takeEdges ? edges.juke : false,
    dive: takeEdges ? edges.dive : false,
    switch: takeEdges ? edges.switch : false,
    throwTo: takeEdges ? edges.throwTo : null,
  };
  if (takeEdges) {
    edges.snap = false;
    edges.juke = false;
    edges.dive = false;
    edges.switch = false;
    edges.throwTo = null;
  }
  return pad;
}

function boothCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function Menu({ sharp, onSharp, onStart, onLink }: { sharp: boolean; onSharp: () => void; onStart: () => void; onLink: () => void }) {
  return (
    <div className="absolute inset-0 flex items-end justify-center px-4 pb-8 sm:items-center">
      <div className="w-full max-w-md rounded-2xl border border-line bg-bg/85 p-5 backdrop-blur-sm">
        <p className="text-xs tracking-widest text-aces">NIGHT FOOTBALL</p>
        <h1 className="mt-1 font-display text-6xl leading-none text-fg">
          NIGHT<span className="text-aces">LINE</span>
        </h1>
        <p className="mt-2 text-sm text-muted">Ridge Aces vs Vesper Kings. Call a play, then run it under the lights.</p>
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" className="flex h-14 items-center justify-center gap-2 rounded-xl bg-aces font-display text-xl tracking-wide text-bg" onClick={onStart}>
            <Play className="size-5" />
            Start
          </button>
          <button type="button" className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface text-fg" onClick={onLink}>
            <Link2 className="size-4" />
            Link a friend
          </button>
          <button type="button" className={`h-11 rounded-xl border text-sm ${sharp ? "border-kings text-kings" : "border-line text-muted"}`} onClick={onSharp}>
            {sharp ? "Sharp CPU on" : "Sharp CPU off"}
          </button>
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted">
          <li>WASD move</li>
          <li>Space snap / throw / juke</li>
          <li>1–5 choose a receiver</li>
          <li>Q switch defender</li>
          <li>F dive for the sticks</li>
          <li>Esc pause</li>
        </ul>
      </div>
    </div>
  );
}

function roomCode(raw: string): string {
  const alnum = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return alnum.length <= 4 ? alnum : alnum.slice(-4);
}

function LinkPanel({ onBack, onHost, onJoin }: { onBack: () => void; onHost: () => void; onJoin: (code: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <div className="absolute inset-0 flex items-end justify-center px-4 pb-8 sm:items-center">
      <div className="w-full max-w-md rounded-2xl border border-line bg-bg/90 p-5">
        <h2 className="font-display text-3xl">Two-player booth</h2>
        <p className="mt-1 text-sm text-muted">
          A private code, then a direct link between your two browsers. For someone you mean to play — not a public lobby.
        </p>
        <button type="button" className="mt-4 h-12 w-full rounded-xl bg-aces font-display text-lg text-bg" onClick={onHost}>
          Host the Aces
        </button>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const next = roomCode(code);
            if (next.length === 4) onJoin(next);
          }}
        >
          <input
            value={code}
            onChange={(e) => setCode(roomCode(e.target.value))}
            placeholder="Code"
            maxLength={64}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="h-12 flex-1 rounded-xl border border-line bg-surface px-3 font-display text-xl tracking-widest text-fg outline-none"
          />
          <button type="submit" className="h-12 rounded-xl border border-kings px-4 text-kings">
            Join
          </button>
        </form>
        <button type="button" className="mt-3 h-10 text-sm text-muted" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

function Online({
  room,
  home,
  hud,
  netRef,
  onMessage,
  onKick,
  onLost,
  onLink,
}: {
  room: string;
  home: boolean;
  hud: Hud;
  netRef: MutableRefObject<{ broadcast: (d: unknown) => void; send: (d: unknown, id?: string) => void } | null>;
  onMessage: (data: unknown) => void;
  onKick: () => void;
  onLost: () => void;
  onLink: (note: string) => void;
}) {
  const p2p = useP2PRoom({ room, name: home ? "Aces" : "Kings" });
  const seen = useRef(false);
  useEffect(() => {
    netRef.current = { broadcast: p2p.broadcast, send: p2p.send };
  }, [netRef, p2p.broadcast, p2p.send]);
  useEffect(() => p2p.onMessage((_from, data) => onMessage(data)), [p2p, onMessage]);
  useEffect(() => {
    const up = p2p.peers.some((p) => p.connectionState === "connected");
    if (up) seen.current = true;
    if (seen.current && p2p.joined && !up && hud.phase !== "lobby" && hud.phase !== "menu") onLost();
    const peer = p2p.peers[0];
    if (!p2p.joined) onLink("Opening the booth…");
    else if (!peer) onLink("Waiting for the other coach");
    else if (peer.connectionState === "connected") onLink(peer.rttMs ? `Linked · ${peer.rttMs} ms` : "Linked");
    else if (peer.connectionState === "failed") onLink("Direct link failed");
    else onLink("Connecting…");
  }, [p2p.peers, p2p.joined, hud.phase, onLost, onLink]);

  if (hud.phase !== "lobby") return null;
  const peer = p2p.peers[0];
  const linked = !!peer && peer.connectionState === "connected";
  return (
    <div className="absolute inset-x-0 bottom-0 flex justify-center px-4 pb-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-bg/90 p-5">
        <p className="text-xs tracking-widest text-muted">{home ? "YOU ARE THE ACES" : "YOU ARE THE KINGS"}</p>
        <p className="mt-2 font-display text-5xl tracking-widest text-fg">{room}</p>
        <button
          type="button"
          className="mt-2 inline-flex items-center gap-2 text-sm text-aces"
          onClick={() => void navigator.clipboard?.writeText(room)}
        >
          <Copy className="size-4" />
          Copy code
        </button>
        <PeerLine peer={peer} joined={p2p.joined} />
        {home ? (
          <button
            type="button"
            disabled={!linked}
            className="mt-4 h-12 w-full rounded-xl bg-aces font-display text-lg text-bg disabled:opacity-40"
            onClick={onKick}
          >
            {linked ? "Kick off" : "Waiting for Kings"}
          </button>
        ) : (
          <p className="mt-4 text-center text-sm text-muted">
            {linked ? "Linked. The game starts when Ridge kicks off." : "Hang on — the link opens, then Ridge kicks off."}
          </p>
        )}
      </div>
    </div>
  );
}

function PeerLine({ peer, joined }: { peer?: PeerInfo; joined: boolean }) {
  if (!joined) return <p className="mt-3 text-sm text-muted">Opening the booth…</p>;
  if (!peer) return <p className="mt-3 text-sm text-muted">Waiting for the other coach.</p>;
  if (peer.connectionState === "connected") {
    return <p className="mt-3 text-sm text-aces">Linked{peer.rttMs ? ` · ${peer.rttMs} ms` : ""}</p>;
  }
  if (peer.connectionState === "failed") {
    return <p className="mt-3 text-sm text-kings">Can’t open a direct link. Try another network, then a new code.</p>;
  }
  return <p className="mt-3 text-sm text-muted">Connecting…</p>;
}

function Scorebug({ hud, muted, onMute, onPause }: { hud: Hud; muted: boolean; onMute: () => void; onPause: () => void }) {
  const q = hud.q >= 5 ? "OT" : `Q${hud.q}`;
  return (
    <div className="flex items-start justify-between gap-2 px-3 pt-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-stretch overflow-hidden rounded-lg border border-line bg-surface/90">
          <div className="bg-aces px-2 py-1 font-display text-sm text-bg sm:px-3 sm:text-base">ACES</div>
          <div className="px-2 font-display text-2xl leading-none tabular-nums sm:px-3 sm:text-3xl">{hud.score[0]}</div>
          <div className="bg-kings px-2 py-1 font-display text-sm text-bg sm:px-3 sm:text-base">KINGS</div>
          <div className="px-2 font-display text-2xl leading-none tabular-nums sm:px-3 sm:text-3xl">{hud.score[1]}</div>
          <div className="flex flex-col justify-center px-2 text-xs text-muted">
            <span className="font-display text-sm text-fg">{q}</span>
            <span className="tabular-nums">{hud.clock}</span>
          </div>
        </div>
        {hud.phase !== "lobby" && hud.phase !== "final" && (
          <div className="mt-2 max-w-xs">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-display text-sm text-fg">{hud.down}</span>
              <span className="text-muted">{hud.spot}</span>
              {hud.phase === "call" && <span className={hud.pc <= 5 ? "text-kings" : "text-muted"}>{hud.pc}s</span>}
            </div>
            <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
              <div className="absolute inset-y-0 left-0 w-1.5 bg-aces" />
              <div className="absolute inset-y-0 right-0 w-1.5 bg-kings" />
              <div className="absolute top-0 h-full w-0.5 bg-bone" style={{ left: `${hud.firstPct}%` }} />
              <div className="absolute top-0 h-full w-1 bg-aces" style={{ left: `${hud.losPct}%` }} />
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-1">
        <button type="button" aria-label={muted ? "Unmute" : "Mute"} className="flex size-11 items-center justify-center rounded-lg border border-line bg-surface text-fg" onClick={onMute}>
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
        <button type="button" aria-label="Pause" className="flex size-11 items-center justify-center rounded-lg border border-line bg-surface text-fg" onClick={onPause}>
          <Pause className="size-4" />
        </button>
      </div>
    </div>
  );
}

function CallSheet({ offense, hud, picked, onPick }: { offense: boolean; hud: Hud; picked: string | null; onPick: (id: string) => void }) {
  const dist = hud.poss === 0 ? 100 - hud.losPct : hud.losPct;
  const suggested = offense ? suggestOff(hud.downN, hud.toGo, dist) : suggestDef(hud.downN, hud.toGo, dist);
  const plays = offense ? OFFENSE : DEFENSE;
  const theirs = hud.ready[hud.myTeam === 0 ? 1 : 0];
  const foe = hud.poss === 0 ? "the Aces" : "the Kings";
  const status = !hud.online
    ? offense
      ? "You have the ball"
      : `Stop ${foe}`
    : picked && !theirs
      ? "Call sent · waiting on them"
      : !picked && theirs
        ? offense
          ? "They're set · your call"
          : "They're set · pick a coverage"
        : offense
          ? "You have the ball"
          : `Stop ${foe}`;
  return (
    <div className="call-sheet overflow-y-auto px-3 pb-4">
      <div className="mx-auto mb-2 flex max-w-3xl items-center justify-between">
        <p className="font-display text-lg">{offense ? "Offense" : "Defense"}</p>
        <p className="text-xs text-muted">{status}</p>
      </div>
      {offense && hud.downN === 4 && !hud.two && (
        <div className="mx-auto mb-2 grid max-w-3xl grid-cols-2 gap-2">
          {KICKS.map((k) => (
            <button key={k.id} type="button" className={`h-16 rounded-xl border px-3 text-left ${picked === k.id ? "border-aces bg-surface" : "border-line bg-surface/80"}`} onClick={() => onPick(k.id)}>
              <span className="block font-display text-lg">{k.name}</span>
              <span className="text-xs text-muted">{k.blurb}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mx-auto grid max-w-3xl grid-cols-1 gap-2 sm:grid-cols-2">
        {plays.map((p) => {
          const run = "group" in p && p.group === "run";
          const hot = p.id === suggested;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p.id)}
              className={`flex min-h-16 gap-3 rounded-xl border bg-surface/85 px-3 py-2 text-left ${picked === p.id ? "border-aces" : hot ? "border-bone" : "border-line"}`}
            >
              <span className={`mt-1 w-1 shrink-0 self-stretch rounded-full ${run ? "bg-aces" : "bg-kings"}`} />
              <span>
                <span className="flex items-center gap-2 font-display text-lg leading-none">
                  {p.name}
                  {hot && <Shield className="size-3.5 text-bone" />}
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {"formation" in p ? `${p.formation} · ` : ""}
                  {p.blurb}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LiveControls({
  targets,
  poss,
  myTeam,
  onThrow,
  onJuke,
  onDive,
  onSwitch,
  onStick,
}: {
  targets: number[];
  poss: TeamId;
  myTeam: TeamId;
  onThrow: (idx: number) => void;
  onJuke: () => void;
  onDive: () => void;
  onSwitch: () => void;
  onStick: (ax: number, ay: number) => void;
}) {
  const names = ["X", "Z", "S", "Y", "H"];
  return (
    <div className="px-3 pb-4">
      {targets.length > 0 && (
        <div className="mx-auto mb-3 flex max-w-3xl justify-center gap-2">
          {targets.map((idx, i) => (
            <button key={idx} type="button" className="h-12 min-w-12 rounded-lg border border-aces bg-surface px-2 font-display text-aces" onClick={() => onThrow(idx)}>
              {i + 1} {names[i]}
            </button>
          ))}
        </div>
      )}
      <div className="mx-auto flex max-w-3xl items-end justify-between">
        <Stick onChange={onStick} />
        <div className="flex gap-2">
          {myTeam !== poss && (
            <button type="button" className="h-14 rounded-xl border border-line bg-surface px-3 text-sm" onClick={onSwitch}>
              Switch
            </button>
          )}
          <button type="button" className="h-14 rounded-xl border border-line bg-surface px-3 text-sm" onClick={onDive}>
            Dive
          </button>
          <button type="button" className="h-14 rounded-xl bg-aces px-4 font-display text-lg text-bg" onClick={onJuke}>
            Juke
          </button>
        </div>
      </div>
    </div>
  );
}

function Stick({ onChange }: { onChange: (ax: number, ay: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const ptr = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  function from(e: React.PointerEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let y = -(e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    setKnob({ x, y });
    onChange(x, y);
  }
  return (
    <div
      ref={ref}
      className="relative h-28 w-28 touch-none rounded-full border border-line bg-surface/80"
      onPointerDown={(e) => {
        ptr.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        from(e);
      }}
      onPointerMove={(e) => {
        if (ptr.current === e.pointerId) from(e);
      }}
      onPointerUp={(e) => {
        if (ptr.current !== e.pointerId) return;
        ptr.current = null;
        setKnob({ x: 0, y: 0 });
        onChange(0, 0);
      }}
    >
      <span
        className="absolute top-1/2 left-1/2 size-11 rounded-full bg-aces"
        style={{ transform: `translate(calc(-50% + ${knob.x * 32}px), calc(-50% - ${knob.y * 32}px))` }}
      />
    </div>
  );
}

function Meter({ dist, label, onKick }: { dist: number; label: string; onKick: (acc: number) => void }) {
  const sweet = dist < 30 ? 0.3 : dist < 40 ? 0.2 : dist < 50 ? 0.12 : 0.07;
  const [pos, setPos] = useState(0.5);
  const posRef = useRef(0.5);
  useEffect(() => {
    let raf = 0;
    const loop = (t: number) => {
      const phase = (t / 850) % 2;
      const x = phase < 1 ? phase : 2 - phase;
      posRef.current = x;
      setPos(x);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="mx-auto mb-5 w-full max-w-md px-4">
      <p className="mb-2 text-center font-display text-xl">{label}</p>
      <div className="relative h-8 overflow-hidden rounded-full border border-line bg-surface">
        <div className="absolute inset-y-1 bg-aces/70" style={{ left: `${50 - sweet * 50}%`, width: `${sweet * 100}%` }} />
        <div className="absolute top-0 h-full w-1 bg-bone" style={{ left: `${pos * 100}%` }} />
      </div>
      <button
        type="button"
        className="mt-3 h-14 w-full rounded-xl bg-aces font-display text-xl text-bg"
        onClick={() => onKick((posRef.current - 0.5) * 2)}
      >
        Kick
      </button>
    </div>
  );
}

function Final({ hud, ask, asked, onAgain, onQuit }: { hud: Hud; ask: boolean; asked: boolean; onAgain: () => void; onQuit: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg/75 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 text-center">
        <p className="text-xs tracking-widest text-muted">FINAL</p>
        <p className="mt-1 font-display text-5xl">
          {hud.score[0]}<span className="text-muted">–</span>{hud.score[1]}
        </p>
        <p className="mt-1 text-sm text-aces">{hud.endNote}</p>
        {ask && <p className="mt-2 text-sm text-kings">They want another kickoff.</p>}
        {asked && <p className="mt-2 text-sm text-muted">Rematch sent. Waiting on the host.</p>}
        <div className="mt-4 grid grid-cols-2 gap-2 text-left text-xs text-muted">
          <span>Aces on the board</span>
          <span className="text-right">Kings on the board</span>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" className="h-12 flex-1 rounded-xl bg-aces font-display text-bg" onClick={onAgain} disabled={asked}>
            {ask ? "Kick it off" : asked ? "Asked" : "Rematch"}
          </button>
          <button type="button" className="h-12 flex-1 rounded-xl border border-line" onClick={onQuit}>
            Menu
          </button>
        </div>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setKeys?: (codes: string[]) => void;
    };
  }
}
