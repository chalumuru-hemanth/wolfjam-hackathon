import { ACTION, ARENA, BEACON, LIGHT, MOVE, ROUND } from "./config.ts";

/**
 * The game rules. Plain data only, with no Colyseus or network imports, so
 * humans, bots and offline practice all run the exact same code.
 *
 * The one rule behind everything: to score, you must be seen.
 */

export interface PlayerInput {
  moveX: number;
  moveY: number;
  action: boolean;
}

export interface SimPlayer {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  score: number;
  cooldown: number;
  stun: number;
  /** Time left being lit up for everyone, after a flash or a hit. */
  exposure: number;
  /** Time left that this player cannot be tagged. */
  immune: number;
  /** Fraction of a beacon point earned so far. */
  charge: number;
  /** Set by applyInput, consumed by stepWorld. */
  actionQueued: boolean;
}

export interface Beacon {
  x: number;
  y: number;
  nextX: number;
  nextY: number;
  /** Seconds until it jumps to the next spot. */
  timer: number;
}

export interface World {
  players: SimPlayer[];
  beacon: Beacon;
  /** Seconds left in the playing phase. */
  timeLeft: number;
  lastLight: boolean;
  random: () => number;
}

export interface SimHit {
  id: string;
  x: number;
  y: number;
  /** Points the flasher gained from this player. */
  gain: number;
  /** Points this player lost. */
  lost: number;
}

export interface SimEvent {
  by: string;
  x: number;
  y: number;
  hits: SimHit[];
}

export const IDLE_INPUT: Readonly<PlayerInput> = { moveX: 0, moveY: 0, action: false };

export function createPlayer(id: string, x: number, y: number): SimPlayer {
  return {
    id,
    x,
    y,
    vx: 0,
    vy: 0,
    score: 0,
    cooldown: 0,
    stun: 0,
    exposure: 0,
    immune: 0,
    charge: 0,
    actionQueued: false,
  };
}

/** Small seeded generator, so a round can be replayed in tests and balance runs. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickBeaconSpot(fromX: number, fromY: number, random: () => number): { x: number; y: number } {
  // A jump can be impossible from the middle, so keep the furthest spot tried.
  let best = { x: fromX, y: fromY };
  let bestDistance = -1;
  for (let attempt = 0; attempt < 16 && bestDistance < BEACON.minJump; attempt++) {
    const spot = {
      x: BEACON.margin + random() * (ARENA.width - BEACON.margin * 2),
      y: BEACON.margin + random() * (ARENA.height - BEACON.margin * 2),
    };
    const distance = Math.hypot(spot.x - fromX, spot.y - fromY);
    if (distance > bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  return best;
}

export function createWorld(random: () => number): World {
  const x = ARENA.width / 2;
  const y = ARENA.height / 2;
  const next = pickBeaconSpot(x, y, random);
  return {
    players: [],
    beacon: { x, y, nextX: next.x, nextY: next.y, timer: BEACON.holdSeconds },
    timeLeft: ROUND.playSeconds,
    lastLight: false,
    random,
  };
}

/** Evenly spaced spawn points on a ring, so no slot starts closer to the middle. */
export function spawnPoint(index: number, total: number): { x: number; y: number } {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2;
  return {
    x: ARENA.width / 2 + Math.cos(angle) * ARENA.height * 0.42,
    y: ARENA.height / 2 + Math.sin(angle) * ARENA.height * 0.42,
  };
}

export function inBeacon(world: World, player: SimPlayer): boolean {
  return Math.hypot(player.x - world.beacon.x, player.y - world.beacon.y) <= BEACON.radius;
}

/** True when this player can be seen from anywhere in the arena. */
export function isExposed(world: World, player: SimPlayer): boolean {
  return world.lastLight || player.exposure > 0 || inBeacon(world, player);
}

/** The whole visibility rule. Clients are only ever sent what this allows. */
export function canSee(world: World, viewer: SimPlayer, target: SimPlayer): boolean {
  if (viewer.id === target.id || isExposed(world, target)) return true;
  return Math.hypot(target.x - viewer.x, target.y - viewer.y) <= LIGHT.sightRadius;
}

/** The next beacon spot, but only once it has been announced. */
export function announcedSpot(beacon: Beacon): { x: number; y: number } {
  return beacon.timer <= BEACON.warnSeconds
    ? { x: beacon.nextX, y: beacon.nextY }
    : { x: beacon.x, y: beacon.y };
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function moveToward(value: number, target: number, maxDelta: number): number {
  if (Math.abs(target - value) <= maxDelta) return target;
  return value + Math.sign(target - value) * maxDelta;
}

/** Turns one player's input into acceleration and a queued action. */
export function applyInput(player: SimPlayer, input: PlayerInput, dt: number): void {
  if (player.stun > 0) {
    player.actionQueued = false;
    return;
  }

  let moveX = finiteOrZero(input.moveX);
  let moveY = finiteOrZero(input.moveY);
  const length = Math.hypot(moveX, moveY);
  if (length > 1) {
    moveX /= length;
    moveY /= length;
  }

  const rate = length > 0 ? MOVE.acceleration : MOVE.friction;
  player.vx = moveToward(player.vx, moveX * MOVE.maxSpeed, rate * dt);
  player.vy = moveToward(player.vy, moveY * MOVE.maxSpeed, rate * dt);
  player.actionQueued = input.action && player.cooldown <= 0;
}

/**
 * THE VERB. A flash tags everyone in reach and steals from them, whether or not
 * the flasher could see them. The price is always the same: it lights the
 * flasher up for the whole arena, hit or miss.
 */
function resolveFlash(actor: SimPlayer, players: readonly SimPlayer[]): SimEvent {
  const hits: SimHit[] = [];
  for (const other of players) {
    if (other.id === actor.id || other.immune > 0) continue;
    const dx = other.x - actor.x;
    const dy = other.y - actor.y;
    const distance = Math.hypot(dx, dy);
    if (distance > ACTION.radius) continue;

    // Players on the exact same spot still need a direction to be pushed in.
    const nx = distance > 0 ? dx / distance : 1;
    const ny = distance > 0 ? dy / distance : 0;
    other.vx = nx * ACTION.knockback;
    other.vy = ny * ACTION.knockback;
    other.stun = ACTION.stunSeconds;
    other.immune = ACTION.immuneSeconds;
    other.exposure = Math.max(other.exposure, LIGHT.hitExposedSeconds);

    const lost = Math.floor(other.score * ACTION.stealFraction);
    const gain = ACTION.tagPoints + lost;
    other.score -= lost;
    actor.score += gain;
    hits.push({ id: other.id, x: other.x, y: other.y, gain, lost });
  }
  actor.cooldown = ACTION.cooldownSeconds;
  actor.exposure = LIGHT.exposedSeconds;
  return { by: actor.id, x: actor.x, y: actor.y, hits };
}

function earnFromBeacon(world: World, dt: number): void {
  const rate = BEACON.pointsPerSecond * (world.lastLight ? BEACON.lastLightMultiplier : 1);
  for (const player of world.players) {
    if (!inBeacon(world, player)) continue;
    player.charge += rate * dt;
    const whole = Math.floor(player.charge);
    player.score += whole;
    player.charge -= whole;
  }
}

function stepBeacon(world: World, dt: number): void {
  const { beacon } = world;
  beacon.timer -= dt;
  if (beacon.timer > 0) return;
  beacon.x = beacon.nextX;
  beacon.y = beacon.nextY;
  const next = pickBeaconSpot(beacon.x, beacon.y, world.random);
  beacon.nextX = next.x;
  beacon.nextY = next.y;
  beacon.timer = BEACON.holdSeconds;
}

function separate(players: readonly SimPlayer[]): void {
  const minDistance = ARENA.playerRadius * 2;
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    if (!a) continue;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j];
      if (!b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= minDistance) continue;
      const nx = distance > 0 ? dx / distance : 1;
      const ny = distance > 0 ? dy / distance : 0;
      const push = (minDistance - distance) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
    }
  }
}

function clampToArena(player: SimPlayer): void {
  const r = ARENA.playerRadius;
  const x = Math.min(Math.max(player.x, r), ARENA.width - r);
  const y = Math.min(Math.max(player.y, r), ARENA.height - r);
  if (x !== player.x) player.vx = 0;
  if (y !== player.y) player.vy = 0;
  player.x = x;
  player.y = y;
}

/** Advances the world by one fixed step and returns what happened. */
export function stepWorld(world: World, dt: number): SimEvent[] {
  const events: SimEvent[] = [];
  const { players } = world;

  world.timeLeft = Math.max(0, world.timeLeft - dt);
  world.lastLight = world.timeLeft <= LIGHT.lastLightSeconds;
  stepBeacon(world, dt);

  // Flashes in the same tick all land. Starting from a random player means
  // nobody wins a tie just by having joined first.
  const offset = Math.floor(world.random() * players.length);
  for (let i = 0; i < players.length; i++) {
    const player = players[(i + offset) % players.length];
    if (!player?.actionQueued) continue;
    player.actionQueued = false;
    events.push(resolveFlash(player, players));
  }

  for (const player of players) {
    player.cooldown = Math.max(0, player.cooldown - dt);
    player.stun = Math.max(0, player.stun - dt);
    player.exposure = Math.max(0, player.exposure - dt);
    player.immune = Math.max(0, player.immune - dt);
    player.x += player.vx * dt;
    player.y += player.vy * dt;
  }

  separate(players);
  for (const player of players) clampToArena(player);
  earnFromBeacon(world, dt);
  return events;
}
