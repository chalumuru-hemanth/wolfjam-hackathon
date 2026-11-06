import { randomUUID } from "node:crypto";
import { Room, type Client } from "colyseus";
import { WaitState, type PlayerKind, type QueueJoinOptions } from "@wolfjam/shared";
import { generateHandle, store } from "../db.ts";
import { dequeue, enqueue, queueDepth } from "../matchmaking.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Holds connected players until the matchmaking loop seats them. This is our
 * own small room, not the Colyseus QueueRoom.
 */
export class WaitRoom extends Room<{ state: WaitState }> {
  override maxClients = 5000;
  /** Queued clients have nothing to say, so anything chatty is misbehaving. */
  override maxMessagesPerSecond = 10;
  override state = new WaitState();

  override onCreate(): void {
    this.clock.setInterval(() => {
      this.state.waiting = queueDepth();
    }, 500);
  }

  override onJoin(client: Client, options: QueueJoinOptions = {}): void {
    const kind: PlayerKind = options.kind === "swarm" ? "swarm" : "human";
    const isHuman = kind === "human";
    const playerId =
      typeof options.playerId === "string" && UUID.test(options.playerId)
        ? options.playerId
        : randomUUID();

    enqueue({
      client,
      kind,
      playerId,
      handle: isHuman ? store.handleFor(playerId) : generateHandle(),
      queuedAt: Date.now(),
    });
  }

  override onLeave(client: Client): void {
    dequeue(client.sessionId);
  }
}
