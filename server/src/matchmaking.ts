import { randomBytes } from "node:crypto";
import { ClientState, matchMaker, type Client } from "colyseus";
import { MATCH, ROOMS, MESSAGES, type ArenaJoinOptions, type PlayerKind } from "@wolfjam/shared";
import { metrics } from "./metrics.ts";

export interface QueuedPlayer {
  client: Client;
  playerId: string;
  handle: string;
  kind: PlayerKind;
  queuedAt: number;
}

/**
 * Arena rooms are registered publicly, because the matchmaker API needs them to
 * be, so a client could otherwise call create("arena") and invent its identity.
 * Only this process knows the key, and arenas refuse anything without it.
 */
export const ROOM_KEY = randomBytes(24).toString("hex");

/** How long a matched client stays in the wait room before it is removed. */
const WAIT_ROOM_GRACE_MS = 3000;

/** Map keeps insertion order, so the oldest player is always first. */
const queue = new Map<string, QueuedPlayer>();

export function enqueue(player: QueuedPlayer): void {
  queue.set(player.client.sessionId, player);
}

export function dequeue(sessionId: string): void {
  queue.delete(sessionId);
}

export function queueDepth(): number {
  return queue.size;
}

/**
 * Takes the next group from one pool, if one is ready. A group is ready when
 * it is full, or when its oldest member has waited out the timeout. Exported
 * for tests: it only reads time from `now`.
 */
export function takeGroup(pool: QueuedPlayer[], now: number): QueuedPlayer[] {
  const oldest = pool[0];
  if (!oldest) return [];
  const full = pool.length >= MATCH.maxPlayers;
  const timedOut = now - oldest.queuedAt >= MATCH.queueTimeoutMs;
  return full || timedOut ? pool.splice(0, MATCH.maxPlayers) : [];
}

async function startMatch(group: QueuedPlayer[]): Promise<void> {
  const now = Date.now();
  for (const player of group) dequeue(player.client.sessionId);

  try {
    const room = await matchMaker.createRoom(ROOMS.arena, {
      expected: group.length,
      roomKey: ROOM_KEY,
    });
    await Promise.all(
      group.map(async (player) => {
        const seatOptions: ArenaJoinOptions = {
          playerId: player.playerId,
          handle: player.handle,
          kind: player.kind,
          roomKey: ROOM_KEY,
        };
        const reservation = await matchMaker.reserveSeatFor(room, seatOptions);
        metrics.recordQueueWait(now - player.queuedAt);
        player.client.send(MESSAGES.matched, reservation);
        setTimeout(() => player.client.leave(), WAIT_ROOM_GRACE_MS);
      }),
    );
  } catch (error) {
    // Failing to start a match must never lose a player: put them back in line.
    console.error("[matchmaking] failed to start match", error);
    for (const player of group) {
      if (player.client.state === ClientState.JOINED) enqueue(player);
    }
  }
}

function runLoop(): void {
  const now = Date.now();
  // Load-test clients never share a room with people.
  const pools: Record<"human" | "swarm", QueuedPlayer[]> = { human: [], swarm: [] };
  for (const player of queue.values()) {
    pools[player.kind === "swarm" ? "swarm" : "human"].push(player);
  }

  for (const pool of Object.values(pools)) {
    for (let group = takeGroup(pool, now); group.length > 0; group = takeGroup(pool, now)) {
      void startMatch(group);
    }
  }
}

export function startMatchmaking(): () => void {
  metrics.setQueueDepthSource(queueDepth);
  const timer = setInterval(runLoop, MATCH.loopIntervalMs);
  return () => clearInterval(timer);
}
