import { BOTS, NET } from '@wolfjam/shared/config';
import { botStyle, decide } from '@wolfjam/shared/brain';
import { announcedSpot, applyInput, canSee, createPlayer, createWorld, IDLE_INPUT, isExposed, spawnPoint, stepWorld } from '@wolfjam/shared/sim';
import type { PlayerInput, SimPlayer, World } from '@wolfjam/shared/sim';
import type { InputFrame } from '../input/InputState.ts';
import type { ConnectionStatus } from '../network/NetworkSession.ts';
import { GAME } from './config.ts';
import type { BeaconSnapshot, GameEvent, GameSession, PlayerSnapshot, RoundSnapshot } from './types.ts';

const SELF = 'you';
const RIVALS = ['Ember', 'Moth', 'Wick'];
const DT = 1 / NET.tickRate;
const DECISION_TICKS = Math.max(1, Math.round(NET.tickRate / BOTS.decisionsPerSecond));
/** A stalled tab catches up this far at most, so a pause cannot fast-forward a round. */
const MAX_STEP_MS = 50;

/** The real rules and bots, running on this device. Used when there is no server. */
export class PracticeSession implements GameSession {
  readonly mode = 'practice' as const;
  readonly players = new Map<string, PlayerSnapshot>();
  beacon: BeaconSnapshot | undefined;
  lastLight = false;
  round: RoundSnapshot = { phase: 'lobby', roundId: '1' };
  private currentStatus: ConnectionStatus = { phase: 'idle', message: '', count: 0 };
  private readonly listeners = new Set<(status: ConnectionStatus) => void>();
  private readonly events = new Set<(event: GameEvent) => void>();
  private readonly clock: () => number;
  private readonly random: () => number;
  private readonly handles = new Map<string, string>();
  private readonly botInputs = new Map<string, PlayerInput>();
  private world: World | undefined;
  private isReady = false;
  private deadline = 0;
  private roundNumber = 1;
  private carryMs = 0;
  private ticks = 0;
  private pendingAction = false;

  constructor(clock: () => number = Date.now, random: () => number = Math.random) { this.clock = clock; this.random = random; }
  get status(): ConnectionStatus { return this.currentStatus; }
  get connected(): boolean { return this.status.phase === 'connected'; }
  get remainingMs(): number {
    return this.round.phase === 'lobby' ? GAME.roundMs : this.round.phase === 'results' ? 0 : Math.max(0, this.deadline - this.clock());
  }
  get cooldownMs(): number { return Math.max(0, (this.sim(SELF)?.cooldown ?? 0) * 1000); }

  async join(): Promise<void> {
    if (this.connected) return;
    this.resetRound();
    this.publish({ phase: 'connected', message: '', count: 4, sessionId: SELF });
  }

  ready(value: boolean): void {
    if (!this.connected || this.round.phase !== 'lobby') return;
    this.isReady = value;
    if (value) { this.round = { ...this.round, phase: 'countdown' }; this.deadline = this.clock() + GAME.countdownMs; }
    this.refresh();
  }

  rematch(): void { if (this.connected && this.round.phase === 'results') this.resetRound(); }

  update(frame: InputFrame, deltaMs: number): void {
    if (!this.connected) return;
    const now = this.clock();
    if (this.round.phase === 'countdown' && now >= this.deadline) {
      this.round = { ...this.round, phase: 'playing' };
      this.deadline += GAME.roundMs;
    }
    if (this.round.phase === 'playing' && now >= this.deadline) { this.round = { ...this.round, phase: 'results' }; this.refresh(); }
    if (this.round.phase !== 'playing' || !this.world) return;

    this.pendingAction ||= frame.actionPressed;
    this.carryMs += Math.min(Math.max(deltaMs, 0), MAX_STEP_MS);
    while (this.carryMs >= DT * 1000) {
      this.carryMs -= DT * 1000;
      this.step(this.world, frame, now);
    }
    this.refresh();
  }

  stopInput(): void { this.pendingAction = false; }
  disconnect(): void {
    this.players.clear(); this.world = undefined; this.beacon = undefined; this.lastLight = false;
    this.round = { phase: 'lobby', roundId: String(this.roundNumber) };
    this.publish({ phase: 'idle', message: '', count: 0 });
  }
  destroy(): void { this.disconnect(); this.listeners.clear(); this.events.clear(); }
  subscribe(callback: (status: ConnectionStatus) => void): () => void {
    this.listeners.add(callback); callback(this.status); return () => { this.listeners.delete(callback); };
  }
  onEvent(callback: (event: GameEvent) => void): () => void { this.events.add(callback); return () => { this.events.delete(callback); }; }

  private sim(id: string): SimPlayer | undefined { return this.world?.players.find((player) => player.id === id); }

  private step(world: World, frame: InputFrame, now: number): void {
    world.timeLeft = Math.max(0, (this.deadline - now) / 1000) + DT;
    if (this.ticks++ % DECISION_TICKS === 0) {
      world.players.forEach((player, seat) => {
        if (player.id !== SELF) this.botInputs.set(player.id, decide(player, world, botStyle(seat), this.random));
      });
    }
    const before = this.sim(SELF)?.score ?? 0;
    for (const player of world.players) {
      if (player.id === SELF) {
        applyInput(player, { moveX: frame.moveX, moveY: frame.moveY, action: this.pendingAction }, DT);
        this.pendingAction = false;
      } else {
        const input = this.botInputs.get(player.id) ?? IDLE_INPUT;
        applyInput(player, input, DT);
        this.botInputs.set(player.id, { ...input, action: false });
      }
    }
    for (const event of stepWorld(world, DT)) {
      this.emit({ type: 'action', playerId: event.by, x: event.x, y: event.y });
      for (const hit of event.hits) this.emit({ type: 'hit', playerId: hit.id, sourceId: event.by, x: hit.x, y: hit.y, lost: hit.lost });
    }
    const self = this.sim(SELF);
    if (self && self.score > before) this.emit({ type: 'score', playerId: SELF, x: self.x, y: self.y, amount: self.score - before });
  }

  private refresh(): void {
    const world = this.world;
    if (!world) return;
    const self = this.sim(SELF);
    const lightsOn = this.round.phase !== 'playing';
    for (const player of world.players) {
      const visible = lightsOn || (self !== undefined && canSee(world, self, player));
      this.players.set(player.id, {
        score: player.score, ready: player.id === SELF ? this.isReady : true, handle: this.handles.get(player.id),
        kind: player.id === SELF ? 'human' : 'bot', connected: true, visible,
        x: visible ? player.x : 0, y: visible ? player.y : 0,
        actionReady: player.cooldown <= 0, stunned: player.stun > 0, exposed: isExposed(world, player), shielded: player.immune > 0,
      });
    }
    const next = announcedSpot(world.beacon);
    this.beacon = { x: world.beacon.x, y: world.beacon.y, nextX: next.x, nextY: next.y, movesIn: Math.ceil(world.beacon.timer),
      warning: next.x !== world.beacon.x || next.y !== world.beacon.y };
    this.lastLight = world.lastLight;
  }

  private emit(event: GameEvent): void { this.events.forEach((callback) => callback(event)); }
  private publish(status: ConnectionStatus): void { this.currentStatus = status; this.listeners.forEach((callback) => callback(status)); }
  private resetRound(): void {
    const world = createWorld(this.random);
    const ids = [SELF, ...RIVALS];
    this.handles.clear(); this.botInputs.clear(); this.players.clear();
    ids.forEach((id, seat) => {
      const spawn = spawnPoint(seat, ids.length);
      world.players.push(createPlayer(id, spawn.x, spawn.y));
      this.handles.set(id, id === SELF ? 'You' : id);
    });
    this.world = world; this.isReady = false; this.carryMs = 0; this.ticks = 0; this.pendingAction = false;
    this.round = { phase: 'lobby', roundId: String(this.roundNumber++) };
    this.refresh();
  }
}
