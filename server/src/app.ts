import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineRoom, defineServer } from "colyseus";
import express, { type NextFunction, type Request, type Response } from "express";
import { ROOMS } from "@wolfjam/shared";
import { SWARM_MAX, swarm } from "./bots/swarm.ts";
import { store } from "./db.ts";
import { metrics } from "./metrics.ts";
import { ArenaRoom } from "./rooms/ArenaRoom.ts";
import { WaitRoom } from "./rooms/WaitRoom.ts";
import { PartyRoom } from './rooms/PartyRoom.ts';
import { findParty } from './parties.ts';

export const PORT = Number(process.env.PORT ?? 2567);

const here = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(here, "../public");
const clientDir = resolve(here, "../../client/dist");
const sdkBundle = resolve(here, "../../node_modules/@colyseus/sdk/dist/colyseus.js");

const METRICS_INTERVAL_MS = 1000;
/** /ops is public, so open streams need a ceiling. */
const MAX_METRICS_STREAMS = 32;
const opsToken = process.env.OPS_TOKEN ?? "";
const isProduction = process.env.NODE_ENV === "production";

function tokenMatches(given: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(opsToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** /ops is public to read. Anything that changes load needs the token. */
function requireOpsToken(req: Request, res: Response, next: NextFunction): void {
  if (!opsToken && !isProduction) return next();
  if (opsToken && tokenMatches(req.get("x-ops-token") ?? "")) return next();
  res.status(401).json({ error: "ops token required" });
}

/** One timer builds each snapshot, however many pages or requests read it. */
const metricsStreams = new Set<Response>();
setInterval(() => {
  const frame = `data: ${JSON.stringify(metrics.publish())}\n\n`;
  for (const stream of metricsStreams) stream.write(frame);
}, METRICS_INTERVAL_MS).unref();

export const server = defineServer({
  rooms: {
    [ROOMS.wait]: defineRoom(WaitRoom),
    [ROOMS.arena]: defineRoom(ArenaRoom),
    party: defineRoom(PartyRoom),
  },
  express: (app) => {
    app.disable("x-powered-by");
    app.use(express.json({ limit: "10kb" }));

    app.get("/healthz", (_req, res) => {
      res.set("Access-Control-Allow-Origin", "*");
      res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) });
    });

    app.get('/api/party/:code', (req, res) => {
      res.set('Access-Control-Allow-Origin', '*');
      const roomId = findParty(req.params.code);
      if (!roomId) { res.status(404).json({ error: 'That room has closed or the code is incorrect. Ask your friend for a new invite.' }); return; }
      res.json({ roomId });
    });

    app.get("/api/leaderboard", (_req, res) => {
      // Read-only and public, so a client hosted elsewhere (itch.io) can show it.
      res.set("Access-Control-Allow-Origin", "*");
      res.json(store.leaderboard());
    });

    app.get("/api/metrics", (_req, res) => {
      res.json(metrics.current());
    });

    app.get("/api/metrics-stream", (req, res) => {
      if (metricsStreams.size >= MAX_METRICS_STREAMS) {
        res.status(503).json({ error: "too many open streams" });
        return;
      }
      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      res.write(`data: ${JSON.stringify(metrics.current())}\n\n`);
      metricsStreams.add(res);
      req.on("close", () => metricsStreams.delete(res));
    });

    app.post("/api/swarm/start", requireOpsToken, (req: Request, res) => {
      const body = req.body as { count?: unknown } | undefined;
      const count = typeof body?.count === "number" ? body.count : 25;
      if (!swarm.start(count, PORT)) {
        res.status(409).json({ error: "swarm already running" });
        return;
      }
      res.json({ started: true, max: SWARM_MAX });
    });

    app.post("/api/swarm/stop", requireOpsToken, (_req, res) => {
      swarm.stop();
      res.json({ stopped: true });
    });

    app.get("/ops", (_req, res) => res.sendFile(resolve(publicDir, "ops.html")));
    app.get("/debug", (_req, res) => res.sendFile(resolve(publicDir, "debug.html")));
    app.get("/vendor/colyseus.js", (_req, res) => res.sendFile(sdkBundle));

    // Same origin as the game server, which removes CORS from the main path.
    if (existsSync(clientDir)) app.use(express.static(clientDir));
    else app.get("/", (_req, res) => res.redirect("/debug"));
  },
});
