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
  const crowd = Array.from({ length: 280 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: 0.7 + Math.random() * 2.2,
    a: 0.15 + Math.random() * 0.45,
    c: Math.random() < 0.5 ? "180, 230, 214" : "255, 170, 184",
  }));
  const sheets = {
    acesBack: loadImg("/sprites/aces-back.png"),
    acesFront: loadImg("/sprites/aces-front.png"),
    kingsBack: loadImg("/sprites/kings-back.png"),
    kingsFront: loadImg("/sprites/kings-front.png"),
    ball: loadImg("/sprites/ball.png"),
    turf: loadImg("/sprites/turf.jpg"),
  };
  let turfPat: CanvasPattern | null = null;
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
      ctx.fillStyle = `rgba(${c.c}, ${c.a * 0.55})`;
      ctx.fillRect(c.x * w, 8 + c.y * (standH - 16), c.r, c.r + 2);
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

    if (sheets.turf.complete && sheets.turf.naturalWidth > 0) {
      turfPat ??= ctx.createPattern(sheets.turf, "repeat");
      if (turfPat) {
        ctx.save();
        ctx.beginPath();
        const poly = [project(0, -SIDELINE, dir, scale, w, h), project(120, -SIDELINE, dir, scale, w, h), project(120, SIDELINE, dir, scale, w, h), project(0, SIDELINE, dir, scale, w, h)];
        ctx.moveTo(poly[0]!.sx, poly[0]!.sy);
        for (const c of poly.slice(1)) ctx.lineTo(c.sx, c.sy);
        ctx.closePath();
        ctx.clip();
        ctx.globalAlpha = 0.34;
        ctx.fillStyle = turfPat;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
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

    drawPosts(ctx, project, dir, scale, w, h);

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
      const controlled = p.id === s.ctrl[local.team] && s.human[local.team];
      const carrier = p.id === s.ball.carrier;
      ctx.fillStyle = "rgba(0,0,0,0.38)";
      ctx.beginPath();
      ctx.ellipse(pos.sx, pos.sy + scale * 0.08, scale * 0.55, scale * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();

      const offense = p.team === s.poss;
      const img =
        p.team === 0
          ? offense
            ? sheets.acesBack
            : sheets.acesFront
          : offense
            ? sheets.kingsBack
            : sheets.kingsFront;
      const moving = Math.hypot(p.vx, p.vy) > 1.1;
      const frame = moving ? Math.floor((rafT * 9 + p.id * 0.37) % 4) : 0;
      const cell = 128;
      const dw = scale * (p.ol ? 1.85 : 2.05);
      const dh = dw;
      ctx.save();
      ctx.translate(pos.sx, pos.sy);
      const lean = Math.max(-0.35, Math.min(0.35, (dir * p.vy) / 14));
      ctx.rotate(p.diving > 0 ? lean + dir * 0.7 : lean);
      if (img.complete && img.naturalWidth >= 64) {
        ctx.drawImage(
          img,
          (frame % 2) * cell,
          Math.floor(frame / 2) * cell,
          cell,
          cell,
          -dw / 2,
          -dh + scale * 0.18,
          dw,
          dh,
        );
      } else {
        const teamColor = p.team === 0 ? ACES : KINGS;
        ctx.fillStyle = teamColor;
        ctx.beginPath();
        ctx.ellipse(0, -scale * 0.45, scale * 0.28, scale * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      if (controlled || carrier) {
        ctx.strokeStyle = controlled ? BONE : p.team === 0 ? ACES : KINGS;
        ctx.globalAlpha = controlled ? 0.9 : 0.45;
        ctx.lineWidth = controlled ? 2 : 1;
        ctx.beginPath();
        ctx.arc(pos.sx, pos.sy - scale * 0.7, scale * 0.95 + (controlled ? Math.sin(rafT * 5) * 0.6 : 0), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (controlled) {
          ctx.fillStyle = BONE;
          ctx.font = `700 ${Math.max(9, scale * 0.42)}px Oswald, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(String(p.num), pos.sx, pos.sy + scale * 0.42);
        }
      }
    }

    const bx = s.ball.state === "held" && ballP ? ballP.x : s.ball.x;
    const by = s.ball.state === "held" && ballP ? ballP.y : s.ball.y;
    const bz = s.ball.state === "held" ? 1.35 : s.ball.z;
    const bp = project(bx, by, dir, scale, w, h);
    const lift = bz * scale * 0.85;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(bp.sx + lift * 0.05, bp.sy + 2, scale * 0.28, scale * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(bp.sx, bp.sy - lift);
    if (s.ball.state === "air") ctx.rotate(Math.atan2(s.ball.vy, s.ball.vx));
    const ballImg = sheets.ball;
    if (ballImg.complete && ballImg.naturalWidth >= 64) {
      const bf = Math.floor(rafT * (s.ball.state === "air" ? 14 : 2)) % 4;
      const cell = 128;
      const bs = scale * (s.ball.state === "air" ? 0.95 : 0.72);
      ctx.drawImage(ballImg, (bf % 2) * cell, Math.floor(bf / 2) * cell, cell, cell, -bs / 2, -bs / 2, bs, bs);
    } else {
      ctx.fillStyle = BONE;
      ctx.beginPath();
      ctx.ellipse(0, 0, scale * 0.34, scale * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.restore();

    const glow = ctx.createRadialGradient(w * 0.5, 0, 10, w * 0.5, h * 0.15, h * 0.55);
    glow.addColorStop(0, "rgba(244, 240, 230, 0.08)");
    glow.addColorStop(1, "rgba(244, 240, 230, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const vig = ctx.createRadialGradient(w / 2, h * 0.55, h * 0.2, w / 2, h * 0.5, h * 0.75);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  };
}

function loadImg(src: string): HTMLImageElement {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  return img;
}

function drawPosts(
  ctx: CanvasRenderingContext2D,
  project: (x: number, y: number, dir: number, scale: number, w: number, h: number) => { sx: number; sy: number },
  dir: number,
  scale: number,
  w: number,
  h: number,
) {
  ctx.strokeStyle = "rgba(244, 240, 230, 0.78)";
  ctx.lineWidth = Math.max(1.5, scale * 0.07);
  ctx.lineCap = "round";
  for (const x of [1.2, 118.8]) {
    const left = project(x, -3.05, dir, scale, w, h);
    const right = project(x, 3.05, dir, scale, w, h);
    const rise = scale * 5.2;
    ctx.beginPath();
    ctx.moveTo(left.sx, left.sy);
    ctx.lineTo(left.sx, left.sy - rise);
    ctx.moveTo(right.sx, right.sy);
    ctx.lineTo(right.sx, right.sy - rise);
    ctx.moveTo(left.sx, left.sy - rise * 0.42);
    ctx.lineTo(right.sx, right.sy - rise * 0.42);
    ctx.stroke();
  }
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


