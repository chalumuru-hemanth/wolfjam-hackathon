import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import type { PartyState } from '@wolfjam/shared/schema';
import type { GameSession, GameEvent, PlayerSnapshot, PartySnapshot } from '../game/types';
import type { InputFrame } from '../input/InputState';
import type { NetworkConfig } from './config';
import { serverHttpUrl } from './config';
import { NetworkSession } from './NetworkSession';
import type { ConnectionStatus } from './NetworkSession';
import { createColyseusConnector } from './colyseus';
import { browserStore, getStoredPlayerId, storedToken, reconnectKey } from './identity';
import type { BrowserStore } from './identity';

export class PartySession implements GameSession {
  readonly mode = 'online' as const;
  private room: Room<PartyState> | undefined;
  private arena: NetworkSession | undefined;
  private arenaRemovers: Array<() => void> = [];
  private readonly roster = new Map<string, PlayerSnapshot>();
  private snapshot: PartySnapshot | undefined;
  private lobbyStatus: ConnectionStatus = { phase: 'idle', message: '', count: 0 };
  private dropped = false;
  private epoch = 0;
  private joinTimeout: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<(status: ConnectionStatus) => void>();
  private readonly events = new Set<(event: GameEvent) => void>();
  constructor(private readonly config: NetworkConfig, private readonly requestedCode = '') {}
  get status(): ConnectionStatus { return this.arena?.status ?? this.lobbyStatus; }
  get connected(): boolean { return ['connected', 'reconnecting'].includes(this.status.phase); }
  get players(): ReadonlyMap<string, PlayerSnapshot> { return this.arena?.players ?? this.roster; }
  get party(): PartySnapshot | undefined { return this.snapshot; }
  get beacon() { return this.arena?.beacon; }
  get lastLight(): boolean { return this.arena?.lastLight ?? false; }
  get watchers(): number { return this.arena?.watchers ?? 0; }
  get round() { return this.arena?.round ?? { phase: 'lobby' as const, roundId: this.snapshot?.code ?? 'party' }; }
  get remainingMs(): number { return this.arena?.remainingMs ?? 60000; }
  get cooldownMs(): number { return this.arena?.cooldownMs ?? 0; }
  get roundResult() { return this.arena?.roundResult; }
  subscribe(callback: (status: ConnectionStatus) => void): () => void { this.listeners.add(callback); callback(this.status); return () => { this.listeners.delete(callback); }; }
  onEvent(callback: (event: GameEvent) => void): () => void { this.events.add(callback); return () => { this.events.delete(callback); }; }
  private publish(): void { this.listeners.forEach((callback) => callback(this.status)); }
  private tokenKey(code: string): string { return 'wolfjam.party:' + this.config.endpoint + ':' + code; }
  private arenaStore(): BrowserStore {
    const store = browserStore('sessionStorage');
    const prefix = 'wolfjam.private-arena:' + (this.snapshot?.code ?? this.requestedCode) + ':';
    return { getItem: (key) => store?.getItem(prefix + key) ?? null,
      setItem: (key, value) => { store?.setItem(prefix + key, value); },
      removeItem: (key) => { store?.removeItem(prefix + key); } };
  }
  private saveRoom(): void {
    if (!this.room || !this.snapshot?.code) return;
    try { const store = browserStore('sessionStorage'); store?.setItem(this.tokenKey(this.snapshot.code), this.room.reconnectionToken); store?.setItem('wolfjam.party.code:' + this.config.endpoint, this.snapshot.code); } catch {}
  }
  async join(): Promise<void> {
    if (this.room || this.lobbyStatus.phase === 'connecting') return;
    const epoch = ++this.epoch;
    this.joinTimeout = setTimeout(() => {
      if (epoch !== this.epoch) return;
      this.disconnect(); this.lobbyStatus = { phase: 'error', message: 'The friend room took too long to respond. Check your connection and try again.', count: 0 }; this.publish();
    }, 30000);
    this.lobbyStatus = { phase: 'connecting', message: 'Opening your friend room…', count: 0 }; this.publish();
    try {
      if (!this.config.endpoint) throw new Error('Friend rooms need an online server. Solo practice works offline.');
      const client = new Client(this.config.endpoint);
      let room: Room<PartyState> | undefined;
      const code = this.requestedCode.trim().toUpperCase().replace(/[\s-]/g, '');
      let token: string | null | undefined;
      try { token = code ? browserStore('sessionStorage')?.getItem(this.tokenKey(code)) : undefined; } catch { /* Private storage is optional. */ }
      if (token) { try { room = await client.reconnect<PartyState>(token); } catch { browserStore('sessionStorage')?.removeItem(this.tokenKey(code)); } }
      if (!room) {
        if (code) {
          if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('Enter the six-character code from your friend.');
          const response = await fetch(serverHttpUrl(this.config.endpoint, '/api/party/' + code), { signal: AbortSignal.timeout(10000) });
          const result = await response.json().catch(() => ({})) as { roomId?: string; error?: string };
          if (!response.ok || !result.roomId) throw new Error(result.error || (response.status === 404 ? 'That room has closed. Ask for a new invite.' : 'Cannot reach the game server. Check your connection and try again.'));
          if (epoch !== this.epoch) return;
          room = await client.joinById<PartyState>(result.roomId, { playerId: getStoredPlayerId() });
        } else room = await client.create<PartyState>('party', { playerId: getStoredPlayerId() });
      }
      if (epoch !== this.epoch) { void room.leave(); return; }
      this.room = room; room.reconnection.enabled = true; room.reconnection.minUptime = 0;
      const receive = (state: PartyState): void => {
        if (epoch !== this.epoch || !state.code || !state.members) return;
        clearTimeout(this.joinTimeout); this.joinTimeout = undefined;
        this.snapshot = { code: state.code, hostId: state.hostId, selfId: room.sessionId, phase: state.phase,
          members: [...state.members].map(([id, member]) => ({ id, handle: member.handle, connected: member.connected })) };
        this.roster.clear();
        this.snapshot.members.forEach((member) => this.roster.set(member.id, { x: 0, y: 0, score: 0, ready: member.id === state.hostId,
          handle: member.handle, kind: 'human', connected: member.connected, visible: false }));
        this.lobbyStatus = { phase: this.dropped ? 'reconnecting' : 'connected', message: this.dropped ? 'Reconnecting to your friends…' : '',
          count: this.roster.size, roomId: room.roomId, sessionId: room.sessionId };
        this.saveRoom();
        if (state.phase === 'playing' && !this.arena && storedToken(this.config.endpoint!, this.arenaStore())) {
          this.enterArena(createColyseusConnector({ reconnectOnly: true, sessionStore: this.arenaStore() }));
        }
        this.publish();
      };
      room.onStateChange(receive); if (room.state?.code) receive(room.state);
      room.onMessage('matched', (reservation: Parameters<Client['consumeSeatReservation']>[0]) => this.enterArena(createColyseusConnector({ reservation, sessionStore: this.arenaStore() })));
      room.onMessage('notice', (message: string) => { this.lobbyStatus.message = message; this.publish(); });
      room.onDrop(() => { this.dropped = true; this.lobbyStatus.phase = 'reconnecting'; this.publish(); });
      room.onReconnect(() => { this.dropped = false; this.saveRoom(); receive(room.state); });
      room.onError(() => { /* SDK reconnect handles a transient WebSocket error. */ });
      room.onLeave(() => { if (epoch === this.epoch) { this.disconnect(); this.lobbyStatus = { phase: 'error', message: 'The friend room closed. Create a new room or join by code.', count: 0 }; this.publish(); } });
    } catch (error) {
      if (epoch !== this.epoch) return;
      let message = error instanceof Error ? error.message : 'Could not open the friend room. Try again.';
      if (/locked|full|maxClients/i.test(message)) message = 'That friend room is full (6 players). Ask your friend for a new room.';
      if (/Failed to fetch|fetch failed|NetworkError/i.test(message)) message = 'Cannot reach the game server. Check your connection and try again.';
      this.disconnect(); this.lobbyStatus = { phase: 'error', message, count: 0 }; this.publish();
    }
  }
  private enterArena(connect: ConstructorParameters<typeof NetworkSession>[0]): void {
    this.clearArena();
    const arena = this.arena = new NetworkSession(connect, this.config, 30000, undefined, false);
    let entered = false;
    this.arenaRemovers = [arena.onEvent((event) => this.events.forEach((callback) => callback(event))), arena.subscribe((status) => {
      if (status.phase === 'connected') entered = true;
      if ((entered && status.phase === 'idle') || ['error', 'disconnected'].includes(status.phase)) {
        if (status.message) console.warn('[friends] Arena connection ended:', status.message);
        const message = status.message; this.clearArena();
        this.lobbyStatus.message = message; this.publish(); return;
      }
      this.publish();
    })];
    void arena.join();
  }
  ready(_value: boolean): void { if (this.snapshot?.hostId === this.snapshot?.selfId && this.snapshot?.phase === 'lobby') this.room?.send('start'); }
  update(frame: InputFrame, delta: number): void { this.arena?.update(frame, delta); }
  stopInput(): void { this.arena?.stopInput(); }
  rematch(): void { /* Arena closure returns everyone to the persistent friend lobby. */ }
  private clearArena(): void { this.arenaRemovers.forEach((remove) => remove()); this.arenaRemovers = []; const arena = this.arena; this.arena = undefined; arena?.destroy(); }
  disconnect(): void {
    ++this.epoch; clearTimeout(this.joinTimeout); this.joinTimeout = undefined; this.clearArena();
    try { this.arenaStore().removeItem(reconnectKey(this.config.endpoint ?? '')); } catch {}
    const code = this.snapshot?.code ?? this.requestedCode;
    try { const store = browserStore('sessionStorage'); store?.removeItem(this.tokenKey(code)); store?.removeItem('wolfjam.party.code:' + this.config.endpoint); } catch {}
    const room = this.room; this.room = undefined; if (room) void room.leave().catch(() => {});
    this.roster.clear(); this.snapshot = undefined; this.dropped = false;
    this.lobbyStatus = { phase: 'idle', message: '', count: 0 }; this.publish();
  }
  destroy(): void { this.disconnect(); this.listeners.clear(); this.events.clear(); }
}
