import { StateView } from "@colyseus/schema";
import {
  Room,
  ServerError,
  type Client,
  type RoomException,
  type RoomMethodName,
  type StepContext,
} from "colyseus";
import {
  announcedSpot,
  applyInput,
  ArenaState,
  BodyState,
  BOTS,
  botStyle,
  canSee,
  createPlayer,
  createWorld,
  decide,
  IDLE_INPUT,
  InputFrame,
  isExposed,
  MATCH,
  MESSAGES,
  NET,
  PlayerState,
  PLAYER_KINDS,
  SelfState,
  ROUND,
  seededRandom,
  spawnPoint,
  stepWorld,
  watchersOf,
  type ArenaJoinOptions,
  type BotStyle,
  type Phase,
  type PlayerInput,
  type PlayerKind,
  type RoundResult,
  type RoundStanding,
  type SimPlayer,
  type World,
} from "@wolfjam/shared";
import { generateHandle, store } from "../db.ts";
import { ROOM_KEY } from "../matchmaking.ts";
import { metrics, type RoomSnapshot } from "../metrics.ts";

interface ArenaCreateOptions {
  /** How many reserved players the matchmaker is sending. */
  expected: number;
  roomKey: string;
}

interface Slot {
  sim: SimPlayer;
  player: PlayerState;
  body: BodyState;
  input: PlayerInput;
  /** Set for bots, which have no client. */
  style?: BotStyle;
}

/** Everyone who took part this round, including players who have since left. */
interface RosterEntry extends RoundStanding {
  playerId: string;
}

const FORBIDDEN = 403;
/** About 30 inputs a second normally, with headroom for bursts after a stall. */
const MAX_MESSAGES_PER_SECOND = 120;

const PHASE_SECONDS: Record<Exclude<Phase, "waiting">, number> = {
  countdown: ROUND.countdownSeconds,
  playing: ROUND.playSeconds,
  results: ROUND.resultsSeconds,
};

const secondsToTicks = (seconds: number): number => Math.round(seconds * NET.tickRate);
const BOT_DECISION_TICKS = Math.max(1, Math.round(NET.tickRate / BOTS.decisionsPerSecond));

function parseKind(value: unknown): PlayerKind {
  return PLAYER_KINDS.find((kind) => kind === value) ?? "human";
}

export class ArenaRoom extends Room<{ state: ArenaState; input: InputFrame }> {
  override maxClients = MATCH.maxPlayers;
  override maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;
  override patchRate = 1000 / NET.patchRate;
  override state = new ArenaState();

  inputs = this.defineInput(InputFrame, {
    bufferMaxSize: NET.maxBufferedInputs,
    sanitize: { moveX: [-1, 1], moveY: [-1, 1] },
  });

  private readonly slots = new Map<string, Slot>();
  private readonly bots = new Set<string>();
  private readonly roster = new Map<string, RosterEntry>();
  private readonly world: World = createWorld(seededRandom(Date.now() & 0x7fffffff));
  private expected = 0;
  private phaseTicksLeft = secondsToTicks(ROUND.joinTimeoutSeconds);
  private tickCount = 0;

  override async onCreate(options: ArenaCreateOptions): Promise<void> {
    if (options.roomKey !== ROOM_KEY) {
      throw new ServerError(FORBIDDEN, "arenas are created by the matchmaker");
    }
    this.expected = options.expected;
    this.state.phase = "waiting";
    this.syncBeacon();
    // Seats only come from the matchmaker, so this room is never listed.
    await this.setPrivate(true);
    metrics.registerRoom(this.roomId, () => this.snapshot());
    this.setFixedTimestep((ctx) => this.step(ctx), NET.tickRate);
  }

  override onDispose(): void {
    metrics.unregisterRoom(this.roomId);
  }

  /** Rejects any join that did not come from a matchmaker seat. */
  override onAuth(_client: Client, options: Partial<ArenaJoinOptions>): boolean {
    return options.roomKey === ROOM_KEY;
  }

  override onJoin(client: Client, options: ArenaJoinOptions): void {
    client.view = new StateView();
    client.view.add(this.state.bodies);
    client.view.add(this.state.selves);
    const self = new SelfState();
    this.state.selves.set(client.sessionId, self);
    client.view.add(self);

    this.addPlayer(client.sessionId, options.playerId, options.handle, parseKind(options.kind));
    if (this.state.phase === "waiting") {
      if (this.clients.length >= this.expected) this.beginRound();
    } else {
      // A slow phone can arrive after the round began. Without this it would
      // start in the top-left corner, away from the spawn ring.
      const spawn = spawnPoint(this.world.players.length - 1, MATCH.maxPlayers);
      const sim = this.slots.get(client.sessionId)?.sim;
      if (sim) {
        sim.x = spawn.x;
        sim.y = spawn.y;
      }
      this.syncViews();
    }
    this.syncVisibility();
  }

  /**
   * Keeps one room's bug from taking down the process and every other match.
   * The room is closed, because its state can no longer be trusted.
   */
  override onUncaughtException(error: RoomException, method: RoomMethodName): void {
    // A refused onCreate is a rejected client, not a fault: no room exists yet.
    if (method === "onCreate") return;
    console.error(`[arena ${this.roomId}] ${method} threw`, error);
    metrics.recordRoomError();
    void this.disconnect();
  }

  override onDrop(client: Client): void {
    const slot = this.slots.get(client.sessionId);
    if (!slot) return;
    slot.player.connected = false;
    slot.input = { ...IDLE_INPUT };
    // Load-test clients never come back, and Kill Swarm must clear at once.
    if (slot.player.kind !== "swarm") this.allowReconnection(client, ROUND.reconnectSeconds);
  }

  override onReconnect(client: Client): void {
    const slot = this.slots.get(client.sessionId);
    if (slot) slot.player.connected = true;
  }

  override onLeave(client: Client): void {
    const id = client.sessionId;
    if (!this.slots.delete(id)) return;
    this.state.players.delete(id);
    this.state.bodies.delete(id);
    this.state.selves.delete(id);
    this.world.players = this.world.players.filter((player) => player.id !== id);
  }

  private addPlayer(
    id: string,
    playerId: string,
    handle: string,
    kind: PlayerKind,
    style?: BotStyle,
  ): void {
    const sim = createPlayer(id, 0, 0);
    const player = new PlayerState();
    player.handle = handle;
    player.kind = kind;
    player.connected = true;
    const body = new BodyState();
    body.actionReady = true;
    this.slots.set(id, { sim, player, body, input: { ...IDLE_INPUT }, style });
    this.world.players.push(sim);
    this.state.players.set(id, player);
    this.state.bodies.set(id, body);
    this.roster.set(id, { id, playerId, handle, kind, score: 0 });
  }

  private beginRound(): void {
    void this.lock();
    // A group that filled the queue plays as is; a timed-out one gets bots.
    for (let i = this.slots.size; i < MATCH.targetPlayers; i++) {
      const id = `bot_${i}`;
      this.bots.add(id);
      this.addPlayer(id, id, generateHandle(), "bot", botStyle(i));
    }
    this.world.players.forEach((player, index) => {
      const spawn = spawnPoint(index, this.world.players.length);
      player.x = spawn.x;
      player.y = spawn.y;
    });
    this.syncViews();
    this.enterPhase("countdown");
  }

  private enterPhase(phase: Exclude<Phase, "waiting">): void {
    this.state.phase = phase;
    this.phaseTicksLeft = secondsToTicks(PHASE_SECONDS[phase]);
    this.state.secondsLeft = PHASE_SECONDS[phase];
  }

  private step(ctx: StepContext): void {
    const started = performance.now();
    this.tickCount++;

    this.readHumanInputs();
    if (this.state.phase === "playing") this.stepPlaying(ctx.dt);
    this.syncVisibility();

    this.phaseTicksLeft--;
    if (this.phaseTicksLeft % NET.tickRate === 0) {
      this.state.secondsLeft = Math.max(0, this.phaseTicksLeft / NET.tickRate);
    }
    if (this.phaseTicksLeft <= 0) this.advancePhase();

    metrics.recordTick(performance.now() - started);
  }

  /**
   * Inputs are drained every tick, even between rounds, so a client can never
   * build up a backlog. The newest move wins, and a press anywhere in the batch
   * counts, so a tap shorter than one tick is not lost.
   */
  private readHumanInputs(): void {
    for (const [id, slot] of this.slots) {
      if (this.bots.has(id) || !slot.player.connected) continue;
      const frames = this.inputs.get(id).drain();
      const newest = frames[frames.length - 1];
      if (!newest) continue;
      slot.input = {
        moveX: newest.moveX,
        moveY: newest.moveY,
        action: frames.some((frame) => frame.action),
      };
    }
  }

  private stepPlaying(dt: number): void {
    if (this.tickCount % BOT_DECISION_TICKS === 0) {
      for (const id of this.bots) {
        const slot = this.slots.get(id);
        if (slot?.style) slot.input = decide(slot.sim, this.world, slot.style, this.world.random);
      }
    }

    for (const slot of this.slots.values()) {
      applyInput(slot.sim, slot.input, dt);
      // A press lasts one tick. Movement persists until the next input arrives.
      slot.input.action = false;
    }

    for (const event of stepWorld(this.world, dt)) {
      this.broadcast(MESSAGES.fx, event);
    }
    this.syncViews();
    this.syncBeacon();
  }

  private syncViews(): void {
    for (const [id, slot] of this.slots) {
      const { sim, player, body } = slot;
      body.x = Math.round(sim.x);
      body.y = Math.round(sim.y);
      body.actionReady = sim.cooldown <= 0;
      body.stunned = sim.stun > 0;
      body.exposed = isExposed(this.world, sim);
      body.shielded = sim.immune > 0;
      player.score = sim.score;
      const entry = this.roster.get(id);
      if (entry) entry.score = sim.score;
    }
  }

  private syncBeacon(): void {
    const { beacon, lastLight } = this.world;
    const next = announcedSpot(beacon);
    this.state.beaconX = Math.round(beacon.x);
    this.state.beaconY = Math.round(beacon.y);
    this.state.beaconNextX = Math.round(next.x);
    this.state.beaconNextY = Math.round(next.y);
    this.state.beaconMovesIn = Math.ceil(beacon.timer);
    this.state.lastLight = lastLight;
  }

  /**
   * The theme, enforced on the wire. A client's view holds only the bodies it is
   * allowed to see, so a hidden player's position never leaves this server and
   * no modified client can reveal it. The lights are on outside active play.
   */
  private syncVisibility(): void {
    const lightsOn = this.state.phase !== "playing";
    let withheld = 0;
    let pairs = 0;

    for (const client of this.clients) {
      const viewer = this.slots.get(client.sessionId);
      const view = client.view;
      if (!viewer || !view) continue;

      for (const slot of this.slots.values()) {
        const visible = lightsOn || canSee(this.world, viewer.sim, slot.sim);
        if (visible !== view.has(slot.body)) {
          if (visible) view.add(slot.body);
          else view.remove(slot.body);
        }
        if (slot !== viewer) {
          pairs++;
          if (!visible) withheld++;
        }
      }

      // Bots count as watchers too: they are hunting by the same rule.
      const self = this.state.selves.get(client.sessionId);
      const watchers = watchersOf(this.world, viewer.sim, lightsOn);
      if (self && self.watchers !== watchers) self.watchers = watchers;
    }
    metrics.recordVisibility(withheld, pairs);
  }

  private advancePhase(): void {
    switch (this.state.phase) {
      case "waiting":
        // Some reserved players never arrived. Start with whoever did.
        if (this.clients.length > 0) this.beginRound();
        else void this.disconnect();
        break;
      case "countdown":
        this.enterPhase("playing");
        break;
      case "playing":
        this.finishRound();
        this.enterPhase("results");
        break;
      case "results":
        void this.disconnect();
        break;
    }
  }

  private finishRound(): void {
    const standings = [...this.roster.values()].sort((a, b) => b.score - a.score);
    const topScore = standings[0]?.score ?? 0;
    // A round where nobody scored has no winner. Every tied leader gets the win.
    const winners = topScore > 0 ? standings.filter((entry) => entry.score === topScore) : [];

    const result: RoundResult = {
      winners: winners.map((entry) => entry.id),
      standings: standings.map(({ id, handle, kind, score }) => ({ id, handle, kind, score })),
    };
    this.broadcast(MESSAGES.roundResult, result);

    // Save on the next turn of the event loop, outside the tick being measured.
    const records = standings.map((entry) => ({ ...entry, id: entry.playerId }));
    const winnerIds = new Set(winners.map((entry) => entry.playerId));
    setImmediate(() => {
      const started = performance.now();
      try {
        store.recordRound(records, winnerIds);
      } catch (error) {
        console.error("[arena] failed to save round", error);
      }
      metrics.recordRound(performance.now() - started);
    });
  }

  private snapshot(): RoomSnapshot {
    const counts: Record<PlayerKind, number> = { human: 0, bot: 0, swarm: 0 };
    for (const slot of this.slots.values()) counts[parseKind(slot.player.kind)]++;
    return { id: this.roomId, phase: this.state.phase, counts };
  }
}
