import type { InputFrame } from '../input/InputState.ts';
import type { NetworkConfig } from './config.ts';
import { encodeInput, INPUT_INTERVAL_MS, readFx, readPlayers, readRound, readRoundResult } from './contract.ts';
import type { WireInput } from './contract.ts';
import type { GameEvent, GameSession, PlayerSnapshot, RoundResult, RoundSnapshot, TargetSnapshot } from '../game/types.ts';
import { GAME } from '../game/config.ts';

export interface RoomConnection {
  readonly id: string; readonly sessionId: string; readonly state: unknown;
  onState(callback: (state: unknown) => void): () => void;
  onError(callback: (code: number, message?: string) => void): () => void;
  onLeave(callback: (code: number) => void): () => void;
  onDrop(callback: () => void): () => void;
  onReconnect(callback: () => void): () => void;
  onFx(callback: (event: unknown) => void): () => void;
  onRoundResult(callback: (result: unknown) => void): () => void;
  sendInput(payload: WireInput): void;
  leave(): Promise<unknown>;
}
export interface ConnectOptions { signal: AbortSignal; progress(message: string): void }
export type ConnectRoom = (config: NetworkConfig, options?: ConnectOptions) => Promise<RoomConnection>;
export type ConnectionPhase = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
export interface ConnectionStatus { phase: ConnectionPhase; message: string; count: number; roomId?: string; sessionId?: string }
export type Every = (callback: () => void, milliseconds: number) => () => void;
const defaultEvery: Every = (callback, milliseconds) => {
  const timer = setInterval(callback, milliseconds);
  if (typeof timer === 'object') timer.unref();
  return () => clearInterval(timer);
};
const STOP: InputFrame = { moveX: 0, moveY: 0, actionHeld: false, actionPressed: false };

export class NetworkSession implements GameSession {
  readonly mode = 'online' as const;
  readonly players = new Map<string, PlayerSnapshot>();
  readonly targets = new Map<string, TargetSnapshot>();
  round: RoundSnapshot = { phase: 'lobby', roundId: '0' };
  roundResult: RoundResult | undefined;
  private room: RoomConnection | undefined;
  private readonly connectRoom: ConnectRoom;
  private readonly config: NetworkConfig;
  private readonly timeoutMs: number;
  private readonly every: Every;
  private generation = 0;
  private readonly listeners = new Set<(status: ConnectionStatus) => void>();
  private readonly events = new Set<(event: GameEvent) => void>();
  private serverRemaining = -1;
  private roundDeadline = 0;
  private unsubscribers: Array<() => void> = [];
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private abort: AbortController | undefined;
  private stopTimer: (() => void) | undefined;
  private latest = { ...STOP };
  private pendingAction = false;
  private currentStatus: ConnectionStatus = { phase: 'idle', message: '', count: 0 };

  constructor(connectRoom: ConnectRoom, config: NetworkConfig, timeoutMs = 30000, every: Every = defaultEvery) {
    this.connectRoom = connectRoom; this.config = config; this.timeoutMs = timeoutMs; this.every = every;
  }
  get status(): ConnectionStatus { return this.currentStatus; }
  get connected(): boolean { return this.status.phase === 'connected' || this.status.phase === 'reconnecting'; }
  get remainingMs(): number { return Math.max(0, this.roundDeadline - Date.now()); }
  get cooldownMs(): number { return this.players.get(this.status.sessionId ?? '')?.actionReady === false ? GAME.actionCooldownMs : 0; }
  // Online rounds start/requeue on the server; these shared-interface controls are practice-only.
  ready(_value: boolean): void {}
  rematch(): void {}
  onEvent(callback: (event: GameEvent) => void): () => void { this.events.add(callback); return () => { this.events.delete(callback); }; }
  subscribe(callback: (status: ConnectionStatus) => void): () => void {
    this.listeners.add(callback); callback(this.status); return () => { this.listeners.delete(callback); };
  }

  async join(): Promise<void> {
    if (this.status.phase === 'connecting' || this.connected) return;
    this.releaseRoom();
    const attempt = ++this.generation;
    const abort = this.abort = new AbortController();
    this.publish({ phase: 'connecting', message: 'Finding players…', count: 0 });
    this.watchdog = setTimeout(() => { if (attempt === this.generation) this.fail('Matchmaking timed out. Check the server and try again.'); }, this.timeoutMs);
    try {
      const room = await this.connectRoom(this.config, { signal: abort.signal, progress: (message) => {
        if (attempt === this.generation) this.publish({ phase: 'connecting', message, count: 0 });
      } });
      if (attempt !== this.generation) { void room.leave().catch(() => {}); return; }
      this.room = room;
      const dropped = (): void => {
        if (attempt !== this.generation) return;
        this.stopInputTimer(); this.clearIntent();
        this.publish({ ...this.status, phase: 'reconnecting', message: 'Reconnecting… Your seat is held for 10 seconds.' });
      };
      const receive = (state: unknown): void => {
        if (attempt !== this.generation) return;
        try {
          const snapshot = readPlayers(state);
          const round = readRound(state, room.id);
          if (round.phase !== this.round.phase) this.clearIntent();
          if (round.phase !== this.round.phase || round.remainingMs !== this.serverRemaining) {
            this.roundDeadline = Date.now() + round.remainingMs; this.serverRemaining = round.remainingMs;
          }
          this.round = { phase: round.phase, roundId: room.id };
          const scoring: GameEvent[] = [];
          snapshot.forEach((player, id) => {
            const previous = this.players.get(id);
            if (previous && player.score > previous.score) scoring.push({ type: 'score', playerId: id, x: player.x, y: player.y, amount: player.score - previous.score });
          });
          this.players.clear(); snapshot.forEach((player, id) => this.players.set(id, player));
          if (!snapshot.has(room.sessionId)) {
            if (this.connected && this.round.phase !== 'results') this.fail('Your player left the arena. Find a new match.');
            return;
          }
          this.clearWatchdog();
          const phase = this.status.phase === 'reconnecting' ? 'reconnecting' : 'connected';
          this.publish({ phase, message: phase === 'reconnecting' ? 'Reconnecting… Your seat is held briefly.' : '',
            count: snapshot.size, roomId: room.id, sessionId: room.sessionId });
          if (phase === 'connected' && !this.stopTimer) this.startInputTimer();
          scoring.forEach((event) => this.emit(event));
        } catch (error) { this.fail(error instanceof Error ? error.message : 'The server state could not be read.'); }
      };
      this.unsubscribers = [
        room.onState(receive),
        room.onError((code, message) => {
          if (attempt !== this.generation) return;
          // WebSocket errors can arrive without a code before the SDK's onDrop event.
          if (this.connected && (!Number.isFinite(code) || [1001, 1005, 1006].includes(code))) { dropped(); return; }
          this.fail(message || 'Server error ' + code);
        }),
        room.onLeave(() => {
          if (attempt !== this.generation) return;
          const next = this.round.phase === 'results';
          ++this.generation; this.releaseRoom();
          this.publish({ phase: next ? 'idle' : 'disconnected', message: next ? '' : 'Connection ended. Find a new match.', count: 0 });
          if (next) void this.join();
        }),
        room.onDrop(dropped),
        room.onReconnect(() => {
          if (attempt !== this.generation) return;
          this.clearIntent();
          this.publish({ ...this.status, phase: 'connected', message: '' });
          this.sendInput(STOP); this.startInputTimer();
        }),
        room.onFx((value) => { if (attempt === this.generation) readFx(value, this.players).forEach((event) => this.emit(event)); }),
        room.onRoundResult((value) => {
          if (attempt !== this.generation) return;
          const result = readRoundResult(value);
          if (result) this.roundResult = result;
        }),
      ];
      const initial = room.state;
      if (typeof initial === 'object' && initial !== null && 'phase' in initial &&
        ['waiting', 'countdown', 'playing', 'results'].includes(String(initial.phase))) receive(initial);
    } catch (error) {
      if (attempt === this.generation) this.fail(error instanceof Error ? error.message : 'Could not find a match.');
    }
  }

  update(frame: InputFrame, _deltaMs: number): void {
    if (this.status.phase !== 'connected' || this.round.phase !== 'playing') return;
    this.latest = { ...frame }; this.pendingAction ||= frame.actionPressed;
  }
  stopInput(): void { this.clearIntent(); if (this.status.phase === 'connected') this.sendInput(STOP); }
  disconnect(): void {
    this.stopInput(); ++this.generation; this.releaseRoom();
    this.publish({ phase: 'idle', message: '', count: 0 });
  }
  destroy(): void { this.disconnect(); this.listeners.clear(); this.events.clear(); }
  private emit(event: GameEvent): void { this.events.forEach((callback) => callback(event)); }
  private clearIntent(): void { this.latest = { ...STOP }; this.pendingAction = false; }
  private startInputTimer(): void {
    this.stopInputTimer();
    this.stopTimer = this.every(() => {
      if (this.status.phase !== 'connected') return;
      const active = this.round.phase === 'playing' && this.players.get(this.status.sessionId ?? '')?.connected !== false;
      const frame = active ? { ...this.latest, actionPressed: this.pendingAction } : STOP;
      this.pendingAction = false; this.sendInput(frame);
    }, INPUT_INTERVAL_MS);
  }
  private stopInputTimer(): void { this.stopTimer?.(); this.stopTimer = undefined; }
  private sendInput(frame: InputFrame): void {
    try { this.room?.sendInput(encodeInput(frame)); } catch { this.fail('Could not send input. Find a new match.'); }
  }
  private fail(message: string): void {
    ++this.generation; this.releaseRoom(); this.publish({ phase: 'error', message, count: 0 });
  }
  private releaseRoom(): void {
    this.clearWatchdog(); this.stopInputTimer(); this.clearIntent();
    this.abort?.abort(); this.abort = undefined;
    this.unsubscribers.forEach((unsubscribe) => unsubscribe()); this.unsubscribers = [];
    const room = this.room; this.room = undefined;
    this.players.clear(); this.targets.clear(); this.roundResult = undefined;
    this.round = { phase: 'lobby', roundId: '0' }; this.serverRemaining = -1; this.roundDeadline = 0;
    if (room) void room.leave().catch(() => {});
  }
  private clearWatchdog(): void { clearTimeout(this.watchdog); this.watchdog = undefined; }
  private publish(status: ConnectionStatus): void {
    const previous = this.currentStatus; this.currentStatus = status;
    if (previous.phase === status.phase && previous.message === status.message && previous.count === status.count &&
      previous.roomId === status.roomId && previous.sessionId === status.sessionId) return;
    this.listeners.forEach((callback) => callback(status));
  }
}
