import type { InputFrame } from '../input/InputState.ts';
import type { BeaconSnapshot, GameEvent, PlayerSnapshot, RoundPhase, RoundResult } from '../game/types.ts';
export type { PlayerSnapshot } from '../game/types.ts';

export const INPUT_INTERVAL_MS = 1000 / 30;
export interface WireInput { moveX: number; moveY: number; action: boolean }
export function encodeInput(frame: InputFrame): WireInput {
  return { moveX: frame.moveX, moveY: frame.moveY, action: frame.actionPressed };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function kind(value: unknown): value is 'human' | 'bot' | 'swarm' { return value === 'human' || value === 'bot' || value === 'swarm'; }

interface BodyLookup { get(id: string): unknown }
function bodyLookup(value: unknown): BodyLookup | undefined {
  return record(value) && typeof value.get === 'function' ? value as unknown as BodyLookup : undefined;
}

/**
 * players is the public roster. bodies holds only the positions this client is
 * allowed to know, so a roster entry with no body is a player hidden in the dark.
 */
export function readPlayers(state: unknown): Map<string, PlayerSnapshot> {
  if (!record(state) || !record(state.players) || typeof state.players.forEach !== 'function') throw new Error('Expected room.state.players to be a MapSchema.');
  const bodies = bodyLookup(state.bodies);
  const players = new Map<string, PlayerSnapshot>();
  state.players.forEach((player: unknown, id: unknown) => {
    if (typeof id !== 'string' || !record(player) || !finite(player.score) || typeof player.handle !== 'string' ||
      !kind(player.kind) || typeof player.connected !== 'boolean') throw new Error('Player state does not match the supplied server contract.');
    const roster = { score: player.score, ready: false, handle: player.handle, kind: player.kind, connected: player.connected };
    const body = bodies?.get(id);
    if (body === undefined) { players.set(id, { ...roster, x: 0, y: 0, visible: false }); return; }
    if (!record(body) || !finite(body.x) || !finite(body.y) || typeof body.actionReady !== 'boolean' || typeof body.stunned !== 'boolean' ||
      typeof body.exposed !== 'boolean' || typeof body.shielded !== 'boolean') throw new Error('Player state does not match the supplied server contract.');
    players.set(id, { ...roster, x: body.x, y: body.y, visible: true, actionReady: body.actionReady, stunned: body.stunned,
      exposed: body.exposed, shielded: body.shielded });
  });
  return players;
}

/** Your own watcher count. The server sends each client only its own entry. */
export function readWatchers(state: unknown, sessionId: string): number {
  if (!record(state)) return 0;
  const self = bodyLookup(state.selves)?.get(sessionId);
  return record(self) && finite(self.watchers) ? self.watchers : 0;
}

export function readBeacon(state: unknown): { beacon: BeaconSnapshot | undefined; lastLight: boolean } {
  if (!record(state) || !finite(state.beaconX) || !finite(state.beaconY)) return { beacon: undefined, lastLight: false };
  const nextX = finite(state.beaconNextX) ? state.beaconNextX : state.beaconX;
  const nextY = finite(state.beaconNextY) ? state.beaconNextY : state.beaconY;
  return {
    beacon: { x: state.beaconX, y: state.beaconY, nextX, nextY, movesIn: finite(state.beaconMovesIn) ? state.beaconMovesIn : 0,
      warning: nextX !== state.beaconX || nextY !== state.beaconY },
    lastLight: state.lastLight === true,
  };
}

export function readRound(state: unknown, roomId: string): { phase: RoundPhase; roundId: string; remainingMs: number } {
  if (!record(state) || !['waiting', 'countdown', 'playing', 'results'].includes(String(state.phase)) ||
    !finite(state.secondsLeft)) throw new Error('Expected phase and secondsLeft from the server contract.');
  return { phase: state.phase === 'waiting' ? 'lobby' : state.phase as RoundPhase, roundId: roomId, remainingMs: Math.max(0, state.secondsLeft * 1000) };
}

function isHit(value: unknown): value is { id: string; x: number; y: number; lost: number } {
  return record(value) && typeof value.id === 'string' && finite(value.x) && finite(value.y) && finite(value.lost);
}

/** A flash is public, and carries hit positions because a victim may be hidden. */
export function readFx(value: unknown): GameEvent[] {
  if (!record(value) || typeof value.by !== 'string' || !finite(value.x) || !finite(value.y) ||
    !Array.isArray(value.hits) || !value.hits.every(isHit)) return [];
  const events: GameEvent[] = [{ type: 'action', playerId: value.by, x: value.x, y: value.y }];
  for (const target of value.hits) {
    events.push({ type: 'hit', playerId: target.id, sourceId: value.by, x: target.x, y: target.y, lost: target.lost });
  }
  return events;
}

export function readRoundResult(value: unknown): RoundResult | undefined {
  if (!record(value) || !Array.isArray(value.winners) || !value.winners.every((id) => typeof id === 'string') ||
    !Array.isArray(value.standings)) return undefined;
  const standings: RoundResult['standings'] = [];
  for (const row of value.standings) {
    if (!record(row) || typeof row.id !== 'string' || typeof row.handle !== 'string' || !kind(row.kind) || !finite(row.score)) return undefined;
    standings.push({ id: row.id, handle: row.handle, kind: row.kind, score: row.score });
  }
  return { winners: [...value.winners] as string[], standings };
}
