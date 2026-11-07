import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTION, ARENA, BEACON, LIGHT, MOVE, NET, ROUND } from "./config.ts";
import {
  announcedSpot,
  applyInput,
  canSee,
  createPlayer,
  createWorld,
  glowRadius,
  IDLE_INPUT,
  inBeacon,
  isExposed,
  seededRandom,
  spawnPoint,
  stepWorld,
  watchersOf,
  type SimPlayer,
  type World,
} from "./sim.ts";
import { botStyle, decide } from "./brain.ts";

const dt = 1 / NET.tickRate;

/** A world whose beacon sits in a far corner, unless a test needs it nearby. */
function worldWith(...players: SimPlayer[]): World {
  const world = createWorld(seededRandom(7));
  world.players = players;
  world.beacon.x = 200;
  world.beacon.y = 200;
  world.beacon.timer = 1000;
  return world;
}

const flash = (world: World, player: SimPlayer) => {
  applyInput(player, { ...IDLE_INPUT, action: true }, dt);
  return stepWorld(world, dt);
};

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
  const world = worldWith(p);
  for (let i = 0; i < 300; i++) {
    applyInput(p, { moveX: -1, moveY: -1, action: false }, dt);
    stepWorld(world, dt);
  }
  assert.equal(p.x, ARENA.playerRadius);
  assert.equal(p.y, ARENA.playerRadius);
});

test("in the dark, a distant player is invisible", () => {
  const a = createPlayer("a", 800, 450);
  const b = createPlayer("b", 1300, 450);
  const world = worldWith(a, b);
  assert.equal(canSee(world, a, b), false);
  assert.equal(canSee(world, b, a), false);
});

test("sight is mutual at close range", () => {
  const a = createPlayer("a", 800, 450);
  const b = createPlayer("b", 800 + LIGHT.sightRadius - 1, 450);
  const world = worldWith(a, b);
  assert.equal(canSee(world, a, b), true);
  assert.equal(canSee(world, b, a), true);
});

test("a player with no points glows only as far as normal sight", () => {
  assert.equal(glowRadius(createPlayer("a", 0, 0)), LIGHT.sightRadius);
});

const glowOff = LIGHT.glowPerPoint === 0 ? "glow is switched off in config" : false;

test("fame is light: points make you visible from further away, up to a cap", { skip: glowOff }, () => {
  const p = createPlayer("a", 0, 0);
  p.score = 20;
  assert.equal(glowRadius(p), LIGHT.sightRadius + 20 * LIGHT.glowPerPoint);
  p.score = 10_000;
  assert.equal(glowRadius(p), LIGHT.sightRadius + LIGHT.maxExtraGlow);
});

test("a glowing leader can be watched by a hunter it cannot see", { skip: glowOff }, () => {
  const leader = createPlayer("leader", 800, 450);
  const hunter = createPlayer("hunter", 800 + LIGHT.sightRadius + 60, 450);
  leader.score = 40;
  const world = worldWith(leader, hunter);
  assert.equal(canSee(world, hunter, leader), true);
  assert.equal(canSee(world, leader, hunter), false);
});

test("watchers counts everyone who can see you, and nobody else", () => {
  const leader = createPlayer("leader", 800, 450);
  const close = createPlayer("close", 900, 450);
  // Outside normal sight, but inside a full glow, whatever the tuning is.
  const reach = LIGHT.sightRadius + LIGHT.maxExtraGlow;
  const far = createPlayer("far", 800 + Math.max(LIGHT.sightRadius + 40, reach - 20), 450);
  const world = worldWith(leader, close, far);
  assert.equal(watchersOf(world, leader), 1);
  if (!glowOff) {
    leader.score = 1000;
    assert.equal(watchersOf(world, leader), 2, "a full glow reaches across this arena");
  }
  assert.equal(watchersOf(world, far), 0);
  assert.equal(watchersOf(world, far, true), 2, "when the lights are on, everyone watches");
});

test("an exposed player is watched by everyone", () => {
  const lit = createPlayer("lit", 200, 200);
  const a = createPlayer("a", 1500, 800);
  const b = createPlayer("b", 1400, 100);
  assert.equal(watchersOf(worldWith(lit, a, b), lit), 2);
});

test("you can always see yourself", () => {
  const a = createPlayer("a", 800, 450);
  assert.equal(canSee(worldWith(a), a, a), true);
});

test("standing in the beacon exposes you to the whole arena", () => {
  const lit = createPlayer("lit", 200, 200);
  const far = createPlayer("far", 1500, 800);
  const world = worldWith(lit, far);
  assert.equal(isExposed(world, lit), true);
  assert.equal(canSee(world, far, lit), true);
  assert.equal(canSee(world, lit, far), false, "being in the light does not help you see out");
});

test("the beacon pays only those inside it, at its stated rate", () => {
  const lit = createPlayer("lit", 200, 200);
  const dark = createPlayer("dark", 1500, 800);
  const world = worldWith(lit, dark);
  for (let i = 0; i < NET.tickRate * 5; i++) stepWorld(world, dt);
  assert.ok(Math.abs(lit.score - 5 * BEACON.pointsPerSecond) <= 1, `got ${lit.score}`);
  assert.equal(dark.score, 0);
});

test("everyone in the beacon earns", () => {
  const a = createPlayer("a", 180, 200);
  const b = createPlayer("b", 260, 200);
  const world = worldWith(a, b);
  for (let i = 0; i < NET.tickRate * 3; i++) stepWorld(world, dt);
  assert.ok(a.score > 0 && b.score > 0);
});

test("the beacon moves on schedule and far from where it was", () => {
  const world = createWorld(seededRandom(3));
  for (let jump = 0; jump < 20; jump++) {
    const before = { x: world.beacon.x, y: world.beacon.y };
    for (let i = 0; i <= NET.tickRate * BEACON.holdSeconds; i++) stepWorld(world, dt);
    const moved = Math.hypot(world.beacon.x - before.x, world.beacon.y - before.y);
    assert.ok(moved >= BEACON.minJump, `only moved ${moved}`);
    assert.ok(world.beacon.x >= BEACON.margin && world.beacon.x <= ARENA.width - BEACON.margin);
    assert.ok(world.beacon.y >= BEACON.margin && world.beacon.y <= ARENA.height - BEACON.margin);
  }
});

test("the next beacon spot stays secret until it is announced", () => {
  const world = createWorld(seededRandom(5));
  world.beacon.timer = BEACON.warnSeconds + 1;
  assert.deepEqual(announcedSpot(world.beacon), { x: world.beacon.x, y: world.beacon.y });
  world.beacon.timer = BEACON.warnSeconds;
  assert.deepEqual(announcedSpot(world.beacon), { x: world.beacon.nextX, y: world.beacon.nextY });
});

test("a flash tags, stuns, shields, exposes the victim, and starts its cooldown", () => {
  const a = createPlayer("a", 800, 450);
  const b = createPlayer("b", 900, 450);
  const world = worldWith(a, b);
  const events = flash(world, a);
  assert.equal(events[0]?.hits[0]?.id, "b");
  assert.equal(a.score, ACTION.tagPoints);
  assert.ok(b.vx > 0);
  assert.ok(b.stun > 0);
  assert.ok(b.immune > 0);
  assert.ok(b.exposure > 0);
  assert.ok(a.cooldown > 0);
});

test("a flash steals a share of the victim's score", () => {
  const a = createPlayer("a", 800, 450);
  const b = createPlayer("b", 900, 450);
  b.score = 40;
  const expected = Math.floor(40 * ACTION.stealFraction);
  const hit = flash(worldWith(a, b), a)[0]?.hits[0];
  assert.equal(hit?.lost, expected);
  assert.equal(b.score, 40 - expected);
  assert.equal(a.score, expected + ACTION.tagPoints);
});

test("score cannot go negative", () => {
  const a = createPlayer("a", 800, 450);
  const b = createPlayer("b", 900, 450);
  flash(worldWith(a, b), a);
  assert.equal(b.score, 0);
});

test("a flash reaches further than you can see, so a blind flash can land", () => {
  assert.ok(ACTION.radius > LIGHT.sightRadius);
  const a = createPlayer("a", 800, 450);
  const b = createPlayer("b", 800 + ACTION.radius - 1, 450);
  const world = worldWith(a, b);
  assert.equal(canSee(world, a, b), false);
  assert.equal(flash(world, a)[0]?.hits.length, 1);
});

test("flashing exposes you even when it misses", () => {
  const a = createPlayer("a", 800, 450);
  const far = createPlayer("far", 1500, 450);
  const world = worldWith(a, far);
  assert.equal(canSee(world, far, a), false);
  assert.equal(flash(world, a)[0]?.hits.length, 0);
  assert.equal(canSee(world, far, a), true);
  for (let i = 0; i < NET.tickRate * (LIGHT.exposedSeconds + 0.1); i++) stepWorld(world, dt);
  assert.equal(canSee(world, far, a), false, "the dark comes back");
});

test("a flash cannot fire again during cooldown", () => {
  const a = createPlayer("a", 800, 450);
  const b = createPlayer("b", 900, 450);
  const world = worldWith(a, b);
  flash(world, a);
  assert.equal(flash(world, a).length, 0);
});

test("a tagged player cannot be tagged again straight away", () => {
  const a = createPlayer("a", 800, 450);
  const b = createPlayer("b", 900, 450);
  const c = createPlayer("c", 800, 550);
  const world = worldWith(a, b, c);
  b.score = 100;
  a.immune = 5;
  c.immune = 5;
  flash(world, a);
  const scoreAfterFirst = b.score;
  applyInput(c, { ...IDLE_INPUT, action: true }, dt);
  assert.equal(stepWorld(world, dt)[0]?.hits.length, 0);
  assert.equal(b.score, scoreAfterFirst);
});

test("a stunned player cannot steer or act", () => {
  const p = createPlayer("a", 800, 450);
  p.stun = 1;
  applyInput(p, { moveX: 1, moveY: 0, action: true }, dt);
  assert.equal(p.vx, 0);
  assert.equal(p.actionQueued, false);
});

test("flashes in the same tick both land, so joining first is no advantage", () => {
  for (let seed = 0; seed < 20; seed++) {
    const a = createPlayer("a", 800, 450);
    const b = createPlayer("b", 900, 450);
    const world = worldWith(a, b);
    world.random = seededRandom(seed);
    applyInput(a, { ...IDLE_INPUT, action: true }, dt);
    applyInput(b, { ...IDLE_INPUT, action: true }, dt);
    assert.equal(stepWorld(world, dt).length, 2);
    assert.equal(a.score, b.score);
  }
});

test("players on the same spot are separated without NaN", () => {
  const a = createPlayer("a", 800, 450);
  const b = createPlayer("b", 800, 450);
  stepWorld(worldWith(a, b), dt);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= ARENA.playerRadius * 2 - 0.001);
});

test("every spawn point for a full room is inside the arena and in the dark", () => {
  const world = createWorld(seededRandom(1));
  for (let i = 0; i < 6; i++) {
    const { x, y } = spawnPoint(i, 6);
    assert.ok(x > ARENA.playerRadius && x < ARENA.width - ARENA.playerRadius);
    assert.ok(y > ARENA.playerRadius && y < ARENA.height - ARENA.playerRadius);
    assert.equal(inBeacon(world, createPlayer("p", x, y)), false);
  }
});

test("Last Light reveals everyone for the final stretch", () => {
  const a = createPlayer("a", 800, 450);
  const b = createPlayer("b", 1500, 800);
  const world = worldWith(a, b);
  world.timeLeft = LIGHT.lastLightSeconds + 0.5;
  stepWorld(world, dt);
  assert.equal(canSee(world, a, b), false);
  for (let i = 0; i < NET.tickRate; i++) stepWorld(world, dt);
  assert.equal(world.lastLight, true);
  assert.equal(canSee(world, a, b), true);
});

test("Last Light multiplies the beacon's pay", () => {
  const a = createPlayer("a", 200, 200);
  const world = worldWith(a);
  world.timeLeft = 5;
  for (let i = 0; i < NET.tickRate * 2; i++) stepWorld(world, dt);
  assert.ok(Math.abs(a.score - 2 * BEACON.pointsPerSecond * BEACON.lastLightMultiplier) <= 1);
});

test("the same seed replays the same round", () => {
  const run = (): number[] => {
    const world = createWorld(seededRandom(99));
    const positions: number[] = [];
    for (let i = 0; i < NET.tickRate * ROUND.playSeconds; i++) {
      stepWorld(world, dt);
      if (i % 300 === 0) positions.push(world.beacon.x);
    }
    return positions;
  };
  assert.deepEqual(run(), run());
});

test("a bot cannot react to a player hidden in the dark", () => {
  const bot = createPlayer("bot", 800, 450);
  const hidden = createPlayer("hidden", 800 + ACTION.radius - 1, 450);
  const world = worldWith(bot, hidden);
  for (let i = 0; i < 200; i++) {
    assert.equal(decide(bot, world, "lurker", () => 0).action, false);
  }
});

test("a bot flashes a player it can see in reach", () => {
  const bot = createPlayer("bot", 800, 450);
  const near = createPlayer("near", 900, 450);
  const world = worldWith(bot, near);
  assert.equal(decide(bot, world, "holder", () => 0).action, true);
  bot.cooldown = 1;
  assert.equal(decide(bot, world, "holder", () => 0).action, false);
});

test("a holder heads for the beacon", () => {
  const bot = createPlayer("bot", 1000, 200);
  const input = decide(bot, worldWith(bot), "holder", () => 0.5);
  assert.ok(input.moveX < -0.9);
});

test("a lurker waits outside the light instead of walking in", () => {
  const bot = createPlayer("bot", 900, 700);
  const world = worldWith(bot);
  world.timeLeft = 1000;
  for (let i = 0; i < NET.tickRate * 6; i++) {
    applyInput(bot, decide(bot, world, "lurker", () => 0.5), dt);
    stepWorld(world, dt);
  }
  assert.equal(inBeacon(world, bot), false);
  const distance = Math.hypot(bot.x - world.beacon.x, bot.y - world.beacon.y);
  assert.ok(distance < BEACON.radius + 180, `still ${distance} away`);
});

test("bot styles alternate, so a filled room gets both", () => {
  assert.deepEqual([0, 1, 2, 3].map(botStyle), ["holder", "lurker", "holder", "lurker"]);
});
