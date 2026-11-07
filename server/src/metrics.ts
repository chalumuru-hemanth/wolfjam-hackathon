import { monitorEventLoopDelay } from "node:perf_hooks";
import { GAME_IDENTITY, NET, type PlayerKind } from "@wolfjam/shared";

const SAMPLE_WINDOW = 2048;

/** Fixed-size window of recent samples. Recording never allocates. */
class RollingSamples {
  private readonly samples = new Float64Array(SAMPLE_WINDOW);
  private next = 0;
  private count = 0;

  record(value: number): void {
    this.samples[this.next] = value;
    this.next = (this.next + 1) % SAMPLE_WINDOW;
    this.count = Math.min(this.count + 1, SAMPLE_WINDOW);
  }

  percentiles(): { p50: number; p95: number } {
    if (this.count === 0) return { p50: 0, p95: 0 };
    const sorted = this.samples.slice(0, this.count).sort();
    return {
      p50: sorted[Math.floor(this.count * 0.5)] ?? 0,
      p95: sorted[Math.floor(this.count * 0.95)] ?? 0,
    };
  }
}

export interface RoomSnapshot {
  id: string;
  phase: string;
  counts: Record<PlayerKind, number>;
}

/** Rooms register a provider so /ops can count them without touching room code. */
type RoomProvider = () => RoomSnapshot;

export interface MetricsSnapshot {
  at: number;
  game: { name: string; theme: string };
  uptimeSeconds: number;
  rooms: number;
  roomsByPhase: Record<string, number>;
  players: { total: number; humans: number; bots: number; swarm: number };
  queue: { depth: number; waitP50Ms: number; waitP95Ms: number };
  tick: { p50Ms: number; p95Ms: number; budgetMs: number; overruns: number; total: number };
  eventLoop: { p50Ms: number; p95Ms: number };
  rounds: { completed: number; dbWriteP95Ms: number; roomErrors: number };
  /** Share of enemy positions the server refused to send, over the last interval. */
  visibility: { withheldPercent: number; withheldPositions: number };
  memoryMb: number;
  swarm: { running: boolean; target: number; connected: number };
}

class Metrics {
  private readonly tickTimes = new RollingSamples();
  private readonly queueWaits = new RollingSamples();
  private readonly dbWrites = new RollingSamples();
  private readonly loop = monitorEventLoopDelay({ resolution: 5 });
  private readonly rooms = new Map<string, RoomProvider>();
  private readonly budgetMs = 1000 / NET.tickRate;
  private ticks = 0;
  private overruns = 0;
  private roundsCompleted = 0;
  private roomErrors = 0;
  private withheld = 0;
  private pairs = 0;
  private withheldTotal = 0;
  private latest: MetricsSnapshot | undefined;
  private queueDepth: () => number = () => 0;
  private swarmStatus: () => MetricsSnapshot["swarm"] = () => ({
    running: false,
    target: 0,
    connected: 0,
  });

  constructor() {
    this.loop.enable();
  }

  recordTick(ms: number): void {
    this.ticks++;
    if (ms > this.budgetMs) this.overruns++;
    this.tickTimes.record(ms);
  }

  recordQueueWait(ms: number): void {
    this.queueWaits.record(ms);
  }

  recordRound(dbWriteMs: number): void {
    this.roundsCompleted++;
    this.dbWrites.record(dbWriteMs);
  }

  recordVisibility(withheld: number, pairs: number): void {
    this.withheld += withheld;
    this.pairs += pairs;
    this.withheldTotal += withheld;
  }

  recordRoomError(): void {
    this.roomErrors++;
  }

  /** The last published snapshot, safe to serve to any number of requests. */
  current(): MetricsSnapshot {
    this.latest ??= this.publish();
    return this.latest;
  }

  registerRoom(id: string, provider: RoomProvider): void {
    this.rooms.set(id, provider);
  }

  unregisterRoom(id: string): void {
    this.rooms.delete(id);
  }

  setQueueDepthSource(source: () => number): void {
    this.queueDepth = source;
  }

  setSwarmSource(source: () => MetricsSnapshot["swarm"]): void {
    this.swarmStatus = source;
  }

  /**
   * Builds a new snapshot. Call this once per interval and no more: it resets
   * the event-loop histogram, so requests must not trigger it directly.
   */
  publish(): MetricsSnapshot {
    const players = { total: 0, humans: 0, bots: 0, swarm: 0 };
    const roomsByPhase: Record<string, number> = {};
    for (const provider of this.rooms.values()) {
      const room = provider();
      roomsByPhase[room.phase] = (roomsByPhase[room.phase] ?? 0) + 1;
      players.humans += room.counts.human;
      players.bots += room.counts.bot;
      players.swarm += room.counts.swarm;
    }
    players.total = players.humans + players.bots + players.swarm;

    const tick = this.tickTimes.percentiles();
    const wait = this.queueWaits.percentiles();
    const db = this.dbWrites.percentiles();
    const loopP50 = this.loop.percentile(50) / 1e6;
    const loopP95 = this.loop.percentile(95) / 1e6;
    this.loop.reset();
    const withheldPercent = this.pairs > 0 ? (this.withheld / this.pairs) * 100 : 0;
    this.withheld = 0;
    this.pairs = 0;

    this.latest = {
      at: Date.now(),
      game: { name: GAME_IDENTITY.name, theme: GAME_IDENTITY.theme },
      uptimeSeconds: Math.round(process.uptime()),
      rooms: this.rooms.size,
      roomsByPhase,
      players,
      queue: { depth: this.queueDepth(), waitP50Ms: wait.p50, waitP95Ms: wait.p95 },
      tick: {
        p50Ms: tick.p50,
        p95Ms: tick.p95,
        budgetMs: this.budgetMs,
        overruns: this.overruns,
        total: this.ticks,
      },
      eventLoop: { p50Ms: loopP50, p95Ms: loopP95 },
      rounds: {
        completed: this.roundsCompleted,
        dbWriteP95Ms: db.p95,
        roomErrors: this.roomErrors,
      },
      visibility: { withheldPercent, withheldPositions: this.withheldTotal },
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      swarm: this.swarmStatus(),
    };
    return this.latest;
  }
}

export const metrics = new Metrics();
