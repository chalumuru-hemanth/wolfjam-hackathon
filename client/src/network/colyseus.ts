import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import type { NetworkConfig } from './config.ts';
import type { ConnectRoom, ConnectOptions, RoomConnection } from './NetworkSession.ts';
import type { WireInput } from './contract.ts';
import { browserStore, getStoredPlayerId, saveToken, storedToken } from './identity.ts';
import type { BrowserStore } from './identity.ts';

type LiveRoom = Room<unknown, unknown>;
type Reservation = Parameters<Client['consumeSeatReservation']>[0];
interface Dependencies { playerId?: () => string; sessionStore?: BrowserStore; reservation?: Reservation; reconnectOnly?: boolean }

export function createColyseusConnector(dependencies: Dependencies = {}): ConnectRoom {
  return async (config: NetworkConfig, options?: ConnectOptions): Promise<RoomConnection> => {
    if (!config.endpoint) throw new Error('The multiplayer server URL has not been configured.');
    const endpoint = config.endpoint;
    const storage = dependencies.sessionStore ?? browserStore('sessionStorage');
    const client = new Client(endpoint);
    const token = dependencies.reservation ? undefined : storedToken(endpoint, storage);
    let room: LiveRoom | undefined = dependencies.reservation ? await client.consumeSeatReservation<unknown>(dependencies.reservation) : undefined;
    if (token) {
      options?.progress('Rejoining your arena…');
      try { room = await client.reconnect<unknown>(token); }
      catch (error) { saveToken(endpoint, undefined, storage); if (dependencies.reconnectOnly) throw error; }
    }
    if (options?.signal.aborted) { if (room) void room.leave(); throw new Error('Matchmaking cancelled.'); }
    if (!room) {
      if (dependencies.reconnectOnly) throw new Error('Your previous round ended. Wait here for the next friend round.');
      options?.progress('Finding players… Solo matches fill after 5 seconds.');
      const playerId = dependencies.playerId?.() ?? getStoredPlayerId();
      const wait = await client.joinOrCreate<unknown>('wait', { playerId });
      room = await consumeMatch(client, wait, options);
    }
    if (options?.signal.aborted) { void room.leave(); throw new Error('Matchmaking cancelled.'); }
    room.reconnection.enabled = true;
    room.reconnection.minUptime = 0;
    let input;
    try { input = room.input<WireInput>(); }
    catch (error) { void room.leave().catch(() => {}); throw error; }
    const live = room;
    saveToken(endpoint, live.reconnectionToken, storage);
    return {
      id: live.roomId, sessionId: live.sessionId,
      get state() { return live.state; },
      onState(callback) { live.onStateChange(callback); return () => live.onStateChange.remove(callback); },
      onError(callback) { live.onError(callback); return () => live.onError.remove(callback); },
      onLeave(callback) {
        const handler = (code: number): void => { saveToken(endpoint, undefined, storage); callback(code); };
        live.onLeave(handler); return () => live.onLeave.remove(handler);
      },
      onDrop(callback) { live.onDrop(callback); return () => live.onDrop.remove(callback); },
      onReconnect(callback) {
        const handler = (): void => { saveToken(endpoint, live.reconnectionToken, storage); callback(); };
        live.onReconnect(handler); return () => live.onReconnect.remove(handler);
      },
      onFx(callback) { return live.onMessage('fx', callback); },
      onRoundResult(callback) { return live.onMessage('round_result', callback); },
      sendInput(value) {
        input.data.moveX = value.moveX; input.data.moveY = value.moveY; input.data.action = value.action;
        input.send();
      },
      leave() { saveToken(endpoint, undefined, storage); return live.leave(); },
    };
  };
}

async function consumeMatch(client: Client, wait: LiveRoom, options?: ConnectOptions): Promise<LiveRoom> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let matching = false;
    const removers: Array<() => void> = [];
    const finish = (error?: unknown, room?: LiveRoom): void => {
      if (settled) { if (room) void room.leave().catch(() => {}); return; }
      settled = true;
      removers.forEach((remove) => remove());
      void wait.leave().catch(() => {});
      if (error) reject(error); else if (room) resolve(room);
    };
    const abort = (): void => finish(new Error('Matchmaking cancelled.'));
    removers.push(wait.onMessage<Reservation>('matched', (reservation) => {
      if (settled || matching) return;
      matching = true;
      options?.progress('Match found. Entering the arena…');
      void client.consumeSeatReservation<unknown>(reservation).then((arena) => finish(undefined, arena), (error: unknown) => finish(error));
    }));
    const onError = (code: number, message?: string): void => finish(new Error(message || 'Matchmaking error ' + code));
    const onLeave = (): void => { if (!matching) finish(new Error('The queue connection closed. Try again.')); };
    wait.onError(onError); wait.onLeave(onLeave);
    removers.push(() => wait.onError.remove(onError), () => wait.onLeave.remove(onLeave));
    if (options) {
      options.signal.addEventListener('abort', abort, { once: true });
      removers.push(() => options.signal.removeEventListener('abort', abort));
      if (options.signal.aborted) abort();
    }
  });
}

export const connectColyseus = createColyseusConnector();
