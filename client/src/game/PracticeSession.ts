import type { InputFrame } from '../input/InputState.ts';
import type { ConnectionStatus } from '../network/NetworkSession.ts';
import { GAME } from './config.ts';
import type { GameEvent, GameSession, PlayerSnapshot, RoundSnapshot, TargetSnapshot } from './types.ts';

/** Offline practice for testing the client. Never used to simulate an online room. */
export class PracticeSession implements GameSession {
  readonly mode = 'practice' as const;
  readonly players = new Map<string, PlayerSnapshot>();
  readonly targets = new Map<string, TargetSnapshot>();
  round: RoundSnapshot = { phase: 'lobby', roundId: '1' };
  private currentStatus: ConnectionStatus = { phase: 'idle', message: '', count: 0 };
  private readonly listeners = new Set<(status: ConnectionStatus) => void>();
  private readonly events = new Set<(event: GameEvent) => void>();
  private readonly respawns = new Map<string, number>();
  private readonly clock: () => number;
  private deadline = 0;
  private cooldownEnd = 0;
  private roundNumber = 1;

  constructor(clock: () => number = Date.now) { this.clock = clock; }
  get status(): ConnectionStatus { return this.currentStatus; }
  get connected(): boolean { return this.status.phase === 'connected'; }
  get remainingMs(): number {
    return this.round.phase === 'lobby' ? GAME.roundMs : this.round.phase === 'results' ? 0 : Math.max(0, this.deadline - this.clock());
  }
  get cooldownMs(): number { return Math.max(0, this.cooldownEnd - this.clock()); }

  async join(): Promise<void> {
    if (this.connected) return;
    this.resetRound();
    this.publish({ phase: 'connected', message: '', count: 1, sessionId: 'you' });
  }

  ready(value: boolean): void {
    const player = this.players.get('you');
    if (!this.connected || !player || this.round.phase !== 'lobby') return;
    player.ready = value;
    if (value) { this.round = { ...this.round, phase: 'countdown' }; this.deadline = this.clock() + GAME.countdownMs; }
  }

  rematch(): void { if (this.connected && this.round.phase === 'results') this.resetRound(); }

  update(frame: InputFrame, deltaMs: number): void {
    if (!this.connected) return;
    const now = this.clock();
    if (this.round.phase === 'countdown' && now >= this.deadline) {
      this.round = { ...this.round, phase: 'playing' };
      this.deadline += GAME.roundMs;
    }
    if (this.round.phase === 'playing' && now >= this.deadline) this.round = { ...this.round, phase: 'results' };
    if (this.round.phase !== 'playing') return;
    const player = this.players.get('you');
    if (!player) return;
    const step = GAME.arena.speed * Math.min(Math.max(deltaMs, 0), 50) / 1000;
    player.x = Math.max(GAME.arena.radius, Math.min(GAME.arena.width - GAME.arena.radius, player.x + frame.moveX * step));
    player.y = Math.max(GAME.arena.radius, Math.min(GAME.arena.height - GAME.arena.radius, player.y + frame.moveY * step));
    this.respawns.forEach((deadline, id) => {
      const target = this.targets.get(id);
      if (now >= deadline && target) { target.active = true; this.respawns.delete(id); }
    });
    if (!frame.actionPressed || now < this.cooldownEnd) return;
    this.cooldownEnd = now + GAME.actionCooldownMs;
    this.emit({ type: 'action', playerId: 'you', x: player.x, y: player.y });
    this.targets.forEach((target, id) => {
      if (!target.active || Math.hypot(target.x - player.x, target.y - player.y) > GAME.actionRadius) return;
      target.active = false;
      this.respawns.set(id, now + 2200);
      player.score++;
      this.emit({ type: 'hit', playerId: 'you', x: target.x, y: target.y });
      this.emit({ type: 'score', playerId: 'you', x: target.x, y: target.y, amount: 1 });
    });
  }

  stopInput(): void { /* Input is sampled each frame, so no held command survives a reset. */ }
  disconnect(): void {
    this.players.clear(); this.targets.clear(); this.respawns.clear();
    this.round = { phase: 'lobby', roundId: String(this.roundNumber) };
    this.publish({ phase: 'idle', message: '', count: 0 });
  }
  destroy(): void { this.disconnect(); this.listeners.clear(); this.events.clear(); }
  subscribe(callback: (status: ConnectionStatus) => void): () => void {
    this.listeners.add(callback); callback(this.status); return () => { this.listeners.delete(callback); };
  }
  onEvent(callback: (event: GameEvent) => void): () => void { this.events.add(callback); return () => { this.events.delete(callback); }; }
  private emit(event: GameEvent): void { this.events.forEach((callback) => callback(event)); }
  private publish(status: ConnectionStatus): void { this.currentStatus = status; this.listeners.forEach((callback) => callback(status)); }
  private resetRound(): void {
    this.players.set('you', { x: 800, y: 450, score: 0, ready: false });
    this.targets.clear(); this.respawns.clear(); this.cooldownEnd = 0;
    this.round = { phase: 'lobby', roundId: String(this.roundNumber++) };
    [[700, 450], [900, 450], [800, 330], [800, 570], [640, 590], [960, 350], [640, 310], [960, 590]].forEach(([x, y], index) => {
      if (x !== undefined && y !== undefined) this.targets.set(`spark-${index}`, { x, y, active: true });
    });
  }
}
