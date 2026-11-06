import { ACTION, ARENA, MOVE } from "./config.ts";

/**
 * The game rules. Plain data only, with no Colyseus or network imports, so
 * humans and bots run the exact same code and it can be unit tested alone.
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
  /** Set by applyInput, consumed by stepWorld. */
  actionQueued: boolean;
}

export interface SimEvent {
  by: string;
  x: number;
  y: number;
  hits: string[];
}

export const IDLE_INPUT: Readonly<PlayerInput> = { moveX: 0, moveY: 0, action: false };

export function createPlayer(id: string, x: number, y: number): SimPlayer {
  return { id, x, y, vx: 0, vy: 0, score: 0, cooldown: 0, stun: 0, actionQueued: false };
}

/** Evenly spaced spawn points on a ring, so no slot starts closer to the middle. */
export function spawnPoint(index: number, total: number): { x: number; y: number } {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2;
  return {
    x: ARENA.width / 2 + Math.cos(angle) * ARENA.height * 0.36,
    y: ARENA.height / 2 + Math.sin(angle) * ARENA.height * 0.36,
  };
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
 * THE VERB. This is the one function to rewrite for the theme.
 * The placeholder pulses outward: everyone in range is shoved and stunned.
 */
function resolveAction(actor: SimPlayer, players: readonly SimPlayer[]): SimEvent {
  const hits: string[] = [];
  for (const other of players) {
    if (other.id === actor.id) continue;
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
    hits.push(other.id);
  }
  actor.score += hits.length * ACTION.pointsPerHit;
  actor.cooldown = ACTION.cooldownSeconds;
  return { by: actor.id, x: actor.x, y: actor.y, hits };
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
export function stepWorld(players: readonly SimPlayer[], dt: number): SimEvent[] {
  const events: SimEvent[] = [];

  for (const player of players) {
    if (player.actionQueued) {
      player.actionQueued = false;
      events.push(resolveAction(player, players));
    }
  }

  for (const player of players) {
    player.cooldown = Math.max(0, player.cooldown - dt);
    player.stun = Math.max(0, player.stun - dt);
    player.x += player.vx * dt;
    player.y += player.vy * dt;
  }

  separate(players);
  for (const player of players) clampToArena(player);
  return events;
}
