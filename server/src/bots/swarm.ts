import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { metrics } from "../metrics.ts";

const AUTO_STOP_MS = 120_000;

export const SWARM_MAX = Number(process.env.SWARM_MAX ?? 150);

export interface SwarmStatusMessage {
  connected: number;
}

/**
 * Runs the load test in a separate process. Inside this process it would share
 * the event loop with the game and distort the tick numbers it is measuring.
 */
class SwarmManager {
  private child: ChildProcess | undefined;
  private autoStop: NodeJS.Timeout | undefined;
  private target = 0;
  private connected = 0;

  constructor() {
    metrics.setSwarmSource(() => ({
      running: this.child !== undefined,
      target: this.target,
      connected: this.connected,
    }));
  }

  /** Returns false when a swarm is already running. */
  start(count: number, port: number): boolean {
    if (this.child) return false;
    this.target = Math.min(Math.max(1, Math.floor(count)), SWARM_MAX);
    this.connected = 0;

    const endpoint = process.env.SWARM_ENDPOINT ?? `http://127.0.0.1:${port}`;
    const worker = fileURLToPath(new URL("./swarm-worker.ts", import.meta.url));
    const child = fork(worker, [endpoint, String(this.target)], {
      execArgv: ["--import", "tsx"],
    });
    this.child = child;

    child.on("message", (message: SwarmStatusMessage) => {
      this.connected = message.connected;
    });
    // Without a listener, a failed spawn would crash the game server.
    child.on("error", (error) => {
      console.error("[swarm] worker failed", error);
      if (this.child === child) this.clear();
    });
    child.on("exit", () => {
      if (this.child === child) this.clear();
    });

    this.autoStop = setTimeout(() => this.stop(), AUTO_STOP_MS);
    return true;
  }

  stop(): void {
    this.child?.kill();
    this.clear();
  }

  private clear(): void {
    clearTimeout(this.autoStop);
    this.child = undefined;
    this.target = 0;
    this.connected = 0;
  }
}

export const swarm = new SwarmManager();
