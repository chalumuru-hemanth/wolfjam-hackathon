import type { GameSession, GameEvent } from './types';
import type { ConnectionStatus } from '../network/NetworkSession';
import type { InputFrame } from '../input/InputState';

/** A stable scene reference, while the player chooses online, friends, or solo. */
export class SessionRouter implements GameSession {
  private removers: Array<() => void> = [];
  private readonly listeners = new Set<(status: ConnectionStatus) => void>();
  private readonly events = new Set<(event: GameEvent) => void>();
  private generation = 0;
  constructor(private driver: GameSession) { this.bind(); }
  use(driver: GameSession): void {
    this.removers.forEach((remove) => remove()); this.driver.destroy(); this.driver = driver; ++this.generation; this.bind();
  }
  private bind(): void {
    this.removers = [this.driver.subscribe((status) => this.listeners.forEach((callback) => callback(status))),
      this.driver.onEvent((event) => this.events.forEach((callback) => callback(event)))];
  }
  get mode() { return this.driver.mode; }
  get status() { return this.driver.status; }
  get connected() { return this.driver.connected; }
  get players() { return this.driver.players; }
  get beacon() { return this.driver.beacon; }
  get lastLight() { return this.driver.lastLight; }
  get watchers() { return this.driver.watchers; }
  get round() { return { ...this.driver.round, roundId: this.generation + ':' + this.driver.round.roundId }; }
  get remainingMs() { return this.driver.remainingMs; }
  get cooldownMs() { return this.driver.cooldownMs; }
  get roundResult() { return this.driver.roundResult; }
  get party() { return this.driver.party; }
  join() { return this.driver.join(); }
  update(frame: InputFrame, delta: number): void { this.driver.update(frame, delta); }
  ready(value: boolean): void { this.driver.ready(value); }
  rematch(): void { this.driver.rematch(); }
  stopInput(): void { this.driver.stopInput(); }
  disconnect(): void { this.driver.disconnect(); }
  destroy(): void { this.removers.forEach((remove) => remove()); this.driver.destroy(); this.listeners.clear(); this.events.clear(); }
  subscribe(callback: (status: ConnectionStatus) => void): () => void { this.listeners.add(callback); callback(this.status); return () => { this.listeners.delete(callback); }; }
  onEvent(callback: (event: GameEvent) => void): () => void { this.events.add(callback); return () => { this.events.delete(callback); }; }
}
