import { offById, defById } from "./plays.ts";
import type { GameState, TeamId } from "./types.ts";
import { FIELD_L, FIELD_R, SIDELINE } from "./types.ts";

const INK = "#07090c";
const TURF_A = "#0e1f19";
const TURF_B = "#13281f";
const ACES = "#2ee6c7";
const KINGS = "#ff5d73";
const BONE = "#f4f0e6";
const LINE = "rgba(223, 236, 228, 0.34)";

export interface DrawLocal {
  team: TeamId;
}

export function createRenderer(canvas: HTMLCanvasElement) {
  const crowd = Array.from({ length: 220 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: 0.6 + Math.random() * 1.8,
    a: 0.12 + Math.random() * 0.4,
  }));
  let camX = 60;
  let camY = 0;
  let zoom = 0;
  let rafT = 0;

  const project = (
    x: number,
    y: number,
    dir: number,
    scale: number,
    w: number,
    h: number,
  ) => {
    const viewUp = dir * (x - camX);
    const viewRight = dir * (y - camY);
    return {
      sx: w / 2 + viewRight * scale,
      sy: h * 0.58 - viewUp * scale,
      up: viewUp,
    };
  };

  return function draw(s: GameState, dt: number, local: DrawLocal) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rafT += dt;

    const live = s.phase === "live";
    const wide = Math.min(w / 62, h / 86);
    const tight = Math.min(w, h) / 34;
    const menuScale = Math.min(w / 78, h / 128);
    zoom += ((live ? 1 : 0) - zoom) * Math.min(1, dt * 1.6);
    let scale = s.phase === "menu" || s.phase === "lobby" ? menuScale : wide + (tight - wide) * zoom;
    scale = Math.max(4, scale);

    const ballP = s.ball.carrier >= 0 ? s.players[s.ball.carrier] : undefined;
    const focusX =
      s.phase === "menu" || s.phase === "lobby"
        ? 60
        : (ballP ? ballP.x : s.ball.x) + (live ? s.dir * 7 : s.dir * 2);
    const focusY = live ? (ballP ? ballP.y : s.ball.y) * 0.55 : 0;
    camX += (focusX - camX) * Math.min(1, dt * 2.8);
    camY += (focusY - camY) * Math.min(1, dt * 2.8);

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const shake = reduced ? 0 : s.shake;
    const ox = Math.sin(rafT * 48) * shake * 7;
    const oy = Math.cos(rafT * 37) * shake * 5;

    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, w, h);

    // Stands
    const standH = Math.max(36, h * 0.14);
    const grd = ctx.createLinearGradient(0, 0, 0, standH);
    grd.addColorStop(0, "#10151c");
    grd.addColorStop(1, "#0a100f");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, standH);
    for (const c of crowd) {
      ctx.fillStyle = `rgba(180, 210, 200, ${c.a * 0.45})`;
      ctx.fillRect(c.x * w, 8 + c.y * (standH - 16), c.r, c.r + 1);
    }
    ctx.fillStyle = "rgba(46, 230, 199, 0.05)";
    ctx.beginPath();
    ctx.ellipse(w * 0.2, 0, w * 0.18, standH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 93, 115, 0.04)";
    ctx.beginPath();
    ctx.ellipse(w * 0.82, 0, w * 0.16, standH, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(ox, oy);

    const dir = s.dir || 1;
    // Turf stripes in world yards
    for (let x = 0; x < 120; x += 5) {
      const a = project(x, -32, dir, scale, w, h);
      const b = project(x + 5, 32, dir, scale, w, h);
      ctx.fillStyle = (x / 5) % 2 === 0 ? TURF_A : TURF_B;
      ctx.fillRect(Math.min(a.sx, b.sx) - 40, Math.min(a.sy, b.sy), Math.abs(b.sx - a.sx) + 80, Math.abs(b.sy - a.sy));
    }

    // End zones
    paintZone(ctx, project, dir, scale, w, h, 0, FIELD_L, ACES, "ACES");
    paintZone(ctx, project, dir, scale, w, h, FIELD_R, 120, KINGS, "KINGS");

    ctx.strokeStyle = LINE;
    ctx.lineWidth = Math.max(1, scale * 0.06);
    for (let x = FIELD_L; x <= FIELD_R; x += 5) {
      const p1 = project(x, -SIDELINE, dir, scale, w, h);
      const p2 = project(x, SIDELINE, dir, scale, w, h);
      ctx.globalAlpha = x % 10 === 0 ? 0.55 : 0.22;
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.7;
    for (const y of [-SIDELINE, SIDELINE]) {
      const p1 = project(0, y, dir, scale, w, h);
      const p2 = project(120, y, dir, scale, w, h);
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(223,236,228,0.45)";
    ctx.font = `600 ${Math.max(9, scale * 0.95)}px Oswald, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let yard = 10; yard <= 100; yard += 10) {
      const x = FIELD_L + yard;
      const label = yard <= 50 ? String(yard) : String(100 - yard);
      for (const side of [-18, 18]) {
        const p = project(x, side, dir, scale, w, h);
        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.rotate(dir === 1 ? -Math.PI / 2 : Math.PI / 2);
        ctx.globalAlpha = 0.28;
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }

    // Hashes
    ctx.globalAlpha = 0.35;
    for (let x = FIELD_L; x <= FIELD_R; x += 1) {
      for (const y of [-3.1, 3.1]) {
        const p = project(x, y, dir, scale, w, h);
        ctx.fillRect(p.sx - scale * 0.18, p.sy, scale * 0.36, Math.max(1, scale * 0.08));
      }
    }
    ctx.globalAlpha = 1;

    if (s.phase !== "menu" && s.phase !== "lobby" && s.kind !== "return") {
      const los1 = project(s.los, -SIDELINE, dir, scale, w, h);
      const los2 = project(s.los, SIDELINE, dir, scale, w, h);
      ctx.strokeStyle = ACES;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(los1.sx, los1.sy);
      ctx.lineTo(los2.sx, los2.sy);
      ctx.stroke();
      const fx = s.los + s.dir * s.toGo;
      const f1 = project(fx, -SIDELINE, dir, scale, w, h);
      const f2 = project(fx, SIDELINE, dir, scale, w, h);
      ctx.strokeStyle = BONE;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(f1.sx, f1.sy);
      ctx.lineTo(f2.sx, f2.sy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    if ((s.phase === "presnap" || s.phase === "live") && local.team === s.poss && s.kind === "scrimmage") {
      const play = offById(s.offId);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ACES;
      ctx.globalAlpha = s.phase === "presnap" ? 0.75 : 0.25;
      ctx.setLineDash([4, 4]);
      for (let i = 0; i < 11; i++) {
        const pl = s.players[s.poss * 11 + i];
        const route = play.routes[i];
        if (!pl || !route || route.length === 0 || play.jobs[i] === "block") continue;
        ctx.beginPath();
        if (pl.path.length && s.simLocal) {
          const p0 = project(pl.x, pl.y, dir, scale, w, h);
          ctx.moveTo(p0.sx, p0.sy);
          for (const wp of pl.path.slice(pl.pi)) {
            const pp = project(wp.x, wp.y, dir, scale, w, h);
            ctx.lineTo(pp.sx, pp.sy);
          }
        } else {
          const p0 = project(pl.x, pl.y, dir, scale, w, h);
          ctx.moveTo(p0.sx, p0.sy);
          for (const wpt of route) {
            const pp = project(pl.x + dir * wpt.f, pl.y + dir * wpt.l, dir, scale, w, h);
            ctx.lineTo(pp.sx, pp.sy);
          }
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    if (s.phase === "presnap" && local.team !== s.poss && s.kind === "scrimmage") {
      const def = defById(s.defId);
      ctx.fillStyle = KINGS;
      for (let i = 0; i < 11; i++) {
        if (def.jobs[i] !== "zone") continue;
        const z = def.zone[i];
        if (!z) continue;
        const p = project(s.los + dir * z.f, dir * z.l, dir, scale, w, h);
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, scale * 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    const order = s.players
      .map((p) => ({ p, sy: project(p.x, p.y, dir, scale, w, h).sy }))
      .sort((a, b) => a.sy - b.sy);

    for (const { p } of order) {
      const pos = project(p.x, p.y, dir, scale, w, h);
      const teamColor = p.team === 0 ? ACES : KINGS;
      const ink = p.team === 0 ? "#06221e" : "#2a0610";
      const controlled = p.id === s.ctrl[local.team] && s.human[local.team];
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(pos.sx, pos.sy + scale * 0.15, scale * 0.62, scale * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();

      const stride = Math.sin(rafT * 14 + p.id) * (Math.hypot(p.vx, p.vy) > 1 ? 1 : 0);
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(1.5, scale * 0.16);
      ctx.beginPath();
      ctx.moveTo(pos.sx - scale * 0.18, pos.sy);
      ctx.lineTo(pos.sx - scale * 0.28, pos.sy + scale * (0.55 + stride * 0.15));
      ctx.moveTo(pos.sx + scale * 0.18, pos.sy);
      ctx.lineTo(pos.sx + scale * 0.28, pos.sy + scale * (0.55 - stride * 0.15));
      ctx.stroke();

      ctx.fillStyle = teamColor;
      roundRect(ctx, pos.sx - scale * 0.46, pos.sy - scale * 0.42, scale * 0.92, scale * 0.7, scale * 0.2);
      ctx.fill();
      // shoulders
      ctx.fillStyle = teamColor;
      roundRect(ctx, pos.sx - scale * 0.62, pos.sy - scale * 0.38, scale * 1.24, scale * 0.36, scale * 0.12);
      ctx.fill();

      ctx.fillStyle = teamColor;
      ctx.beginPath();
      ctx.arc(pos.sx, pos.sy - scale * 0.62, scale * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(7,9,12,0.55)";
      ctx.fillRect(pos.sx - scale * 0.22, pos.sy - scale * 0.68, scale * 0.44, scale * 0.08);

      ctx.fillStyle = ink;
      ctx.font = `700 ${Math.max(8, scale * 0.42)}px Oswald, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(p.num), pos.sx, pos.sy - scale * 0.05);

      if (controlled) {
        ctx.strokeStyle = BONE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pos.sx, pos.sy - scale * 0.2, scale * 0.95 + Math.sin(rafT * 5) * 0.8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Ball
    const bx = s.ball.state === "held" && ballP ? ballP.x : s.ball.x;
    const by = s.ball.state === "held" && ballP ? ballP.y : s.ball.y;
    const bz = s.ball.state === "held" ? 1.2 : s.ball.z;
    const bp = project(bx, by, dir, scale, w, h);
    const lift = bz * scale * 0.85;
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(bp.sx, bp.sy + 2, scale * 0.28, scale * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(bp.sx, bp.sy - lift);
    const ang = Math.atan2(s.ball.vy, s.ball.vx);
    ctx.rotate(s.ball.state === "air" ? ang : rafT * 2);
    ctx.fillStyle = BONE;
    ctx.beginPath();
    ctx.ellipse(0, 0, scale * 0.34, scale * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2a241c";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-scale * 0.08, 0);
    ctx.lineTo(scale * 0.08, 0);
    ctx.stroke();
    ctx.restore();

    ctx.restore();

    // Vignette
    const vig = ctx.createRadialGradient(w / 2, h * 0.55, h * 0.2, w / 2, h * 0.5, h * 0.75);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  };
}

function paintZone(
  ctx: CanvasRenderingContext2D,
  project: (x: number, y: number, dir: number, scale: number, w: number, h: number) => { sx: number; sy: number },
  dir: number,
  scale: number,
  w: number,
  h: number,
  x0: number,
  x1: number,
  color: string,
  label: string,
) {
  const corners = [
    project(x0, -SIDELINE - 1, dir, scale, w, h),
    project(x1, -SIDELINE - 1, dir, scale, w, h),
    project(x1, SIDELINE + 1, dir, scale, w, h),
    project(x0, SIDELINE + 1, dir, scale, w, h),
  ];
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.moveTo(corners[0]!.sx, corners[0]!.sy);
  for (const c of corners.slice(1)) ctx.lineTo(c.sx, c.sy);
  ctx.closePath();
  ctx.fill();
  const mid = project((x0 + x1) / 2, 0, dir, scale, w, h);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = color;
  ctx.font = `700 ${Math.max(14, scale * 2.1)}px Oswald, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, mid.sx, mid.sy);
  ctx.globalAlpha = 1;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
