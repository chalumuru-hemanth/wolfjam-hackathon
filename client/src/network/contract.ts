import type { InputFrame } from '../input/InputState.ts';
import type { GameEvent, PlayerSnapshot, RoundPhase, RoundResult } from '../game/types.ts';
export type { PlayerSnapshot } from '../game/types.ts';

export const INPUT_INTERVAL_MS = 1000 / 30;
export interface WireInput { moveX: number; moveY: number; action: boolean }
export function encodeInput(frame: InputFrame): WireInput {
  return { moveX: frame.moveX, moveY: frame.moveY, action: frame.actionPressed };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function kind(value: unknown): value is 'human' | 'bot' | 'swarm' { return value === 'human' || value === 'bot' || value === 'swarm'; }

export function readPlayers(state: unknown): Map<string, PlayerSnapshot> {
  if (!record(state) || !record(state.players) || typeof state.players.forEach !== 'function') throw new Error('Expected room.state.players to be a MapSchema.');
  const players = new Map<string, PlayerSnapshot>();
  state.players.forEach((player: unknown, id: unknown) => {
    if (typeof id !== 'string' || !record(player) || !finite(player.x) || !finite(player.y) || !finite(player.score) ||
      typeof player.handle !== 'string' || !kind(player.kind) || typeof player.actionReady !== 'boolean' ||
      typeof player.stunned !== 'boolean' || typeof player.connected !== 'boolean') throw new Error('Player state does not match the supplied server contract.');
    players.set(id, { x: player.x, y: player.y, score: player.score, ready: false, handle: player.handle,
      kind: player.kind, actionReady: player.actionReady, stunned: player.stunned, connected: player.connected });
  });
  return players;
}

export function readRound(state: unknown, roomId: string): { phase: RoundPhase; roundId: string; remainingMs: number } {
  if (!record(state) || !['waiting', 'countdown', 'playing', 'results'].includes(String(state.phase)) ||
    !finite(state.secondsLeft)) throw new Error('Expected phase and secondsLeft from the server contract.');
  return { phase: state.phase === 'waiting' ? 'lobby' : state.phase as RoundPhase, roundId: roomId, remainingMs: Math.max(0, state.secondsLeft * 1000) };
}

export function readFx(value: unknown, players: ReadonlyMap<string, PlayerSnapshot>): GameEvent[] {
  if (!record(value) || typeof value.by !== 'string' || !finite(value.x) || !finite(value.y) ||
    !Array.isArray(value.hits) || !value.hits.every((id) => typeof id === 'string')) return [];
  const events: GameEvent[] = [{ type: 'action', playerId: value.by, x: value.x, y: value.y }];
  for (const id of value.hits) {
    const target = players.get(id);
    if (target) events.push({ type: 'hit', playerId: id, sourceId: value.by, x: target.x, y: target.y });
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
