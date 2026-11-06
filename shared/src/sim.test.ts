import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTION, ARENA, MOVE, NET } from "./config.ts";
import { applyInput, createPlayer, IDLE_INPUT, spawnPoint, stepWorld } from "./sim.ts";

const dt = 1 / NET.tickRate;

test("diagonal input is not faster than straight input", () => {
  const p = createPlayer("a", 800, 450);
  for (let i = 0; i < 60; i++) applyInput(p, { moveX: 1, moveY: 1, action: false }, dt);
  assert.ok(Math.hypot(p.vx, p.vy) <= MOVE.maxSpeed + 0.001);
});

test("oversized and NaN input cannot exceed max speed", () => {
  const p = createPlayer("a", 800, 450);
  for (let i = 0; i < 60; i++) applyInput(p, { moveX: 9999, moveY: Number.NaN, action: false }, dt);
  assert.ok(Math.hypot(p.vx, p.vy) <= MOVE.maxSpeed + 0.001);
  assert.ok(Number.isFinite(p.x));
});

test("players cannot leave the arena", () => {
  const p = createPlayer("a", 40, 40);
  for (let i = 0; i < 300; i++) {
    applyInput(p, { moveX: -1, moveY: -1, action: false }, dt);
    stepWorld([p], dt);
  }
  assert.equal(p.x, ARENA.playerRadius);
  assert.equal(p.y, ARENA.playerRadius);
});

test("the action scores, knocks back, stuns and starts its cooldown", () => {
  const a = createPlayer("a", 800, 450);
  const b = createPlayer("b", 900, 450);
  applyInput(a, { ...IDLE_INPUT, action: true }, dt);
  const events = stepWorld([a, b], dt);
  assert.deepEqual(events[0]?.hits, ["b"]);
  assert.equal(a.score, ACTION.pointsPerHit);
  assert.ok(b.vx > 0);
  assert.ok(b.stun > 0);
  assert.ok(a.cooldown > 0);
});

test("the action cannot fire again during cooldown", () => {
  const a = createPlayer("a", 800, 450);
  const b = createPlayer("b", 900, 450);
  applyInput(a, { ...IDLE_INPUT, action: true }, dt);
  stepWorld([a, b], dt);
  applyInput(a, { ...IDLE_INPUT, action: true }, dt);
  assert.equal(stepWorld([a, b], dt).length, 0);
});

test("a stunned player cannot steer or act", () => {
  const p = createPlayer("a", 800, 450);
  p.stun = 1;
  applyInput(p, { moveX: 1, moveY: 0, action: true }, dt);
  assert.equal(p.vx, 0);
  assert.equal(p.actionQueued, false);
});

test("players on the same spot are separated without NaN", () => {
  const a = createPlayer("a", 800, 450);
  const b = createPlayer("b", 800, 450);
  stepWorld([a, b], dt);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= ARENA.playerRadius * 2 - 0.001);
});

test("every spawn point for a full room is inside the arena", () => {
  for (let i = 0; i < 6; i++) {
    const { x, y } = spawnPoint(i, 6);
    assert.ok(x > ARENA.playerRadius && x < ARENA.width - ARENA.playerRadius);
    assert.ok(y > ARENA.playerRadius && y < ARENA.height - ARENA.playerRadius);
  }
});
