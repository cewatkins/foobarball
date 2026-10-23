import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beginSolo,
  choosePlay,
  createMatch,
  neutralPad,
  step,
  viewYaw,
} from "./sim.ts";
import type { Pad } from "./types.ts";

function hold(ax: number, ay: number): Pad {
  return { ...neutralPad(), ax, ay };
}

describe("nightline", () => {
  it("lines up the quarterback behind the ball", () => {
    const s = createMatch();
    s.phase = "call";
    s.human = [true, true];
    choosePlay(s, 0, "zone");
    choosePlay(s, 1, "cover2");
    assert.equal(s.phase, "presnap");
    const qb = s.players[0]!;
    assert.ok(Math.abs(qb.x - 30) < 0.2, `qb x ${qb.x}`);
    assert.ok(Math.abs(qb.y) < 0.2, `qb y ${qb.y}`);
    const wr = s.players[2]!;
    assert.ok(wr.y < -20, `split end y ${wr.y}`);
  });

  it("moves the returner upfield, and A is screen-left", () => {
    const s = createMatch();
    beginSolo(s);
    assert.equal(s.phase, "live");
    const start = s.ball.x;
    const pad = hold(0, 1);
    for (let i = 0; i < 60; i++) step(s, 1 / 60, [pad, neutralPad()]);
    assert.ok(s.ball.x > start + 2, `gain ${s.ball.x - start}`);
    const p = s.players[s.ctrl[0]]!;
    assert.ok(viewYaw(s.dir, p.vx, p.vy) > -0.2);
    const y0 = viewYaw(s.dir, p.vx, p.vy);
    const left = hold(-1, 1);
    for (let i = 0; i < 20; i++) step(s, 1 / 60, [left, neutralPad()]);
    const y1 = viewYaw(s.dir, s.players[s.ctrl[0]]!.vx, s.players[s.ctrl[0]]!.vy);
    assert.ok(y1 > y0 + 0.2, `A yaw ${y0} -> ${y1}`);
  });

  it("finishes a kickoff and accepts a play call", () => {
    const s = createMatch();
    beginSolo(s);
    const idle: [Pad, Pad] = [neutralPad(), neutralPad()];
    for (let i = 0; i < 900 && s.phase === "live"; i++) step(s, 1 / 60, idle);
    assert.notEqual(s.phase, "live");
    for (let i = 0; i < 200 && s.phase === "dead"; i++) step(s, 1 / 60, idle);
    assert.equal(s.phase, "call");
    choosePlay(s, 0, "slant");
    assert.equal(s.phase, "presnap");
    const snap = { ...neutralPad(), snap: true };
    step(s, 1 / 60, [snap, neutralPad()]);
    assert.equal(s.phase, "live");
    for (let i = 0; i < 400 && s.phase === "live"; i++) step(s, 1 / 60, idle);
    assert.notEqual(s.phase, "live");
    assert.ok(s.score[0] >= 0 && s.score[1] >= 0);
  });
});
