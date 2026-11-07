import type { InputFrame } from '../input/InputState.ts';
import type { ConnectionStatus } from '../network/NetworkSession.ts';

export interface Point { x: number; y: number }
export interface PlayerSnapshot extends Point {
  score: number; ready: boolean; handle?: string; kind?: 'human' | 'bot' | 'swarm';
  actionReady?: boolean; stunned?: boolean; connected?: boolean;
}
export interface TargetSnapshot extends Point { active: boolean }
export type RoundPhase = 'lobby' | 'countdown' | 'playing' | 'results';
export interface RoundSnapshot { phase: RoundPhase; roundId: string }
export interface RoundResult { winners: string[]; standings: Array<{ id: string; handle: string; kind: string; score: number }> }
export type GameEvent =
  | ({ type: 'action'; playerId: string } & Point)
  | ({ type: 'hit'; playerId: string; sourceId?: string } & Point)
  | ({ type: 'score'; playerId: string; amount: number } & Point);

/** Both drivers expose the same view. Only PracticeSession simulates gameplay locally. */
export interface GameSession {
  readonly mode: 'practice' | 'online';
  readonly status: ConnectionStatus;
  readonly connected: boolean;
  readonly players: ReadonlyMap<string, PlayerSnapshot>;
  readonly targets: ReadonlyMap<string, TargetSnapshot>;
  readonly round: RoundSnapshot;
  readonly remainingMs: number;
  readonly cooldownMs: number;
  readonly roundResult?: RoundResult;
  join(): Promise<void>;
  update(frame: InputFrame, deltaMs: number): void;
  ready(value: boolean): void;
  rematch(): void;
  stopInput(): void;
  disconnect(): void;
  destroy(): void;
  subscribe(callback: (status: ConnectionStatus) => void): () => void;
  onEvent(callback: (event: GameEvent) => void): () => void;
}

export function standings(players: ReadonlyMap<string, PlayerSnapshot>): Array<{ id: string; score: number }> {
  return [...players].map(([id, player]) => ({ id, score: player.score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
