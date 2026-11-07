# Nightlight: Phaser client

Phaser 4.1.0, Vite, and strict TypeScript. Touch joystick + action button, WASD + Space, HTML title/lobby/countdown/results, 60-second practice rounds, interpolation, shake, particles, hit feedback, score popups, and four local CC0 sounds.

The online adapter follows [the server contract](../docs/CONTRACT.md). The client is an npm workspace in this repository; the production Docker build serves it from the same origin as Colyseus. A standalone checkout also supports local practice.

## Open the game

**Windows: double-click PLAY.cmd.** It opens an existing game server or starts Vite first. Keep its terminal window open while playing. The cross-platform equivalent is:

    npm run play

For manual startup, use Node 24 (minimum 22.18):

    npm ci
    npm run dev

Open the HTTP Local/Network URL printed by Vite. Opening index.html directly from Explorer cannot load the TypeScript app; it now shows launch help and a link to the working server instead of an unstyled game screen.

In a standalone development checkout without a server URL, **Play practice → Ready · Start practice** runs the real game rules and bots on this device, so it also works without a network.

## Connect Sylesh's server

Run his backend according to its README (npm install, then npm run dev at the server repo root). For the separately served client, set this in the ignored .env.local, then restart Vite:

    VITE_COLYSEUS_URL=http://SERVER_NETWORK_IP:2567

Use a URL reachable from phones. localhost on a phone points to the phone itself. HTTPS pages need an HTTPS/WSS server endpoint.

The client uses @colyseus/sdk 0.18.9 with the documented Colyseus 0.18 protocol:
- A stable UUID in localStorage identifies the player. Handles come from the server.
- Find match joins **wait**, receives **matched**, and consumes the arena seat reservation. It never joins/creates an arena directly.
- The server matches a solo player after 5 seconds with bots filling to 4; six queued players start immediately.
- room.input() sends moveX, moveY, action on a fixed approximately 30 Hz timer. Server state arrives at 20 Hz; the client interpolates positions without prediction.
- waiting/countdown/playing/results and secondsLeft drive the UI. Online start is automatic; there are no ready/rematch commands.
- fx supplies action/hit feedback. Score changes come from state. round_result supplies authoritative winners and standings, including ties and empty winners.
- Results last 8 seconds; when the server closes the room the client automatically queues again.
- SDK reconnection is enabled with minUptime = 0. Input is cleared while reconnecting. sessionStorage holds the reconnect token so reloads restore the seat; tokens never go into QR links.

The supplied arena dimensions are **1600×900**, radius **28**. Human/bot/swarm kind, assigned handle, actionReady, stunned, and connected flags are mapped into presentation. Disconnected actors are dimmed, and the action button shows WAIT/STUNNED when appropriate.

See [SERVER_CONTRACT.md](docs/SERVER_CONTRACT.md) for the exact mapping and deployment handoff.

## Phone / QR

1. Connect the phone and laptop/server to the same Wi-Fi for local testing.
2. Open Vite's Network URL on the laptop and scan its QR on the phone.
3. For a QR while viewing localhost, set VITE_JOIN_URL in .env.local to the laptop's Network URL.
4. Hold the left joystick while tapping the large right button; both orientations are supported.

Online QR links enter the queue; the server assigns rooms. They do not reserve a particular arena. Obsolete room query parameters are removed. A reachable current LAN/hosted origin takes precedence over a development QR override; loopback/wildcard URLs are never encoded.

Join QR pauses input while keeping the current seat. Back to arena restores the current phase. Blur/backgrounding, cancellation, rotation, and viewport changes clear input and send an immediate stop.

Venue Wi-Fi may isolate devices. If the phone cannot reach the Network URL, check Wi-Fi/firewall access or use a hotspot.

## Build modes and server packaging

    npm run build

This is the **server-integrated production build**. Without an explicit endpoint, it connects to location.origin, as required by Sylesh's deployment contract.

For a standalone static practice build:

    npm run build:practice
    npm run preview

Preview uses port 4173. A normal development server uses 5173. Both ports are fixed so QR destinations cannot silently change.

To include this app in the backend build, place its working files under the server repo's client/ folder, add client to the root workspaces, and run the backend's existing Docker/build workflow. The app already has a build script and outputs to client/dist. Do not copy node_modules, .git, or development .env.local into the server deployment. No backend files were changed here.

The standalone client has no SQLite dependency, so npm ci is appropriate here. Follow the server README's npm install instruction at the backend workspace root. The launcher resolves Vite from standalone or hoisted workspace dependencies.

## Checks

    npm test
    npm run build
    npm run test:e2e

Strict type checks cover app code, configs, and tests. Unit checks cover input, fixed sending, schema mapping, timeout/abort races, reconnect zeroing, server timing/winners, identity storage, exact local round boundaries, cooldowns, and rematch.

Browser checks cover desktop 1280×800, portrait 390×844, landscape 844×390, full practice rounds, audio unlock/decode, simultaneous two-finger controls, cancellation, rotation during held input, and fresh-input recovery after focus loss. Browser tests use an installed Chrome in an isolated profile, not your signed-in browser. Traces and screenshots go under the ignored test-results/ folder.

A temporary real Colyseus fixture verified queue → reservation → arena, six synchronized clients, binary room.input(), fx/score, early-drop SDK reconnect, authoritative winners, auto-requeue, and browser reload/seat restoration. Integration was then checked against this repository's actual backend with six humans, production same-origin serving, movement/action effects, reload seat recovery, a full 60-second round, results, and automatic requeue. Physical phone/Safari verification remains pending.

## Adaptation points

- src/network/contract.ts: server DTO parsing and normalized client state.
- src/network/colyseus.ts / identity.ts: queue, SDK input, reconnect, and persistent identity.
- src/game/config.ts / PracticeSession.ts: neutral presentation and the replaceable local practice rule.
- src/ui/GameUi.ts: HTML state flow, handles, scores, and authoritative results.
- src/scenes/: world/HUD rendering and touch ownership.
- src/effects/Juice.ts / audio/AudioBus.ts: bounded cosmetic feedback only.

## Device acceptance before submission

- [ ] QR opens the actual backend/client from a real phone.
- [ ] Portrait/landscape, safe areas, and phone-speaker audio after the first tap.
- [ ] Simultaneous movement/action, releasing fingers in either order/outside controls.
- [ ] Background/rotate/reload and recover without stale movement.
- [ ] Real wait queue, human/bot actors, cooldown/stun, results/ties, 8-second requeue, and reconnect on Sylesh's implementation.

## Credits

Kenney [Interface Sounds 1.0](https://kenney.nl/assets/interface-sounds), **CC0**: action = bong_001, hit = drop_004, score = confirmation_001, win = confirmation_004. Four short mono PCM WAVs are loaded locally; original OGGs and the source license are retained. No music or settings screen.

Phaser, Colyseus, Vite, node-qrcode and supporting runtime license texts are included; TypeScript is Apache-2.0. Barlow Condensed and DM Sans use SIL OFL 1.1 and are bundled locally. All visuals are code-drawn shapes/polygons, with no AI-generated art. Runtime notices are copied to dist/licenses/.

The team cutoff remains Saturday, November 7, 2026 at 10:00 PM EST. This scaffold was prepared before kickoff at the user's request.
