import { swarm } from "./bots/swarm.ts";
import { PORT, server } from "./app.ts";
import { store } from "./db.ts";
import { startMatchmaking } from "./matchmaking.ts";

const stopMatchmaking = startMatchmaking();

server.onShutdown(() => {
  stopMatchmaking();
  swarm.stop();
  store.close();
});

// Colyseus only logs a failed listen and keeps running. A server with no port
// must exit, so the host sees a crash and restarts it instead of hanging.
process.on("uncaughtException", (error) => {
  console.error("[server] fatal", error);
  process.exit(1);
});

try {
  await server.listen(PORT, "0.0.0.0");
  console.log(`[server] listening on ${PORT}`);
} catch (error) {
  console.error("[server] could not start", error);
  process.exit(1);
}
