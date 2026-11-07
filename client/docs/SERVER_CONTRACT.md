# Client mapping of the supplied Sylesh contract

The expanded friends flow is documented in the repository's docs/CONTRACT.md: a persistent party room owns the invite code, host controls, and protected arena reservations. Quick matchmaking remains separate. Solo practice is always selectable and runs entirely on the device after loading.

Source: the supplied README.md and CONTRACT.md, cross-checked with this repository's shared/src/protocol.ts and shared/src/schema.ts.

## Connection and deployment

Colyseus 0.18, client SDK currently pinned at 0.18.9. Production defaults to location.origin. Separate development uses VITE_COLYSEUS_URL. Put the app under client/, add client to the backend root workspaces, and use its existing Docker build; this package outputs client/dist.

Normal build: npm run build. Standalone practice build: npm run build:practice.

No backend, ops-console, SQLite, leaderboard, or bot logic is implemented by this client.

## Queue and identity

1. Generate/store a UUID under wolfjam.playerId in localStorage.
2. client.joinOrCreate('wait', { playerId }).
3. On matched, client.consumeSeatReservation(reservation).
4. Leave the wait room, set arena.reconnection.minUptime = 0, and subscribe to the arena.
5. If the queue/seat request is cancelled, clean up its listeners and any late-arriving room.

The server assigns display names. A solo queue fills to four with bots after five seconds; six queued players start immediately. There is no name-entry UI or direct arena join. A QR links to the queue entry URL, not an arena ID.

## Input

    const input = room.input();
    input.data.moveX = ...; // -1..1
    input.data.moveY = ...; // -1..1
    input.data.action = ...;
    input.send();

A fixed timer sends approximately 30 times/second even when values are unchanged. A short action tap is latched until one send; held input does not replay stale actions after reconnect. Stop/reset sends zero immediately. The server normalizes movement and owns cooldowns/actions; no client prediction/replay layer is used.

## Server state at 20 Hz

Root:
- phase: waiting, countdown, playing, results.
- secondsLeft: whole seconds left in the phase.
- players: public roster keyed by room.sessionId. Everyone is always listed.
- bodies: positions this client may know. A hidden player has no entry.
- beaconX, beaconY, beaconNextX, beaconNextY, beaconMovesIn, lastLight.

Player: handle, kind, score, connected.

Body: x, y, actionReady, stunned, exposed, shielded.

The client maps waiting to its internal lobby view. It displays server time with a local visual countdown between patches; it never ends an online round by itself. Player positions use simple interpolation at rendering frequency. A player with no body is rendered as hidden, and snaps into place when next seen rather than sliding across the arena.

## Server messages

fx:

    { by: string, x: number, y: number, hits: [{ id, x, y, gain, lost }] }

The client creates a flash at x/y and hit feedback at the positions carried by the message, because a victim may be hidden from this client. State score deltas create score popups; fx never awards points. Local hit feedback controls shake/hit pause, while visible remote effects remain cosmetic.

round_result:

    {
      winners: string[],
      standings: [{ id, handle, kind, score }]
    }

These winners are authoritative, including empty winners and ties. The client uses the supplied handles/kinds/standings even if a player leaves the current state map.

## Results and reconnection

Results last eight seconds, then room.onLeave triggers a new wait-room queue automatically. There is no online ready/rematch message.

For dropped connections, the SDK retries while the server holds the seat for ten seconds. minUptime is zero so early drops reconnect too. A transport onError without a usable code can precede onDrop; it must not force a consented leave that cancels the SDK retry. Input stops during the hold and resumes with zero/fresh intent.

The room reconnect token is kept in sessionStorage, scoped to its endpoint. On reload the client tries client.reconnect(token) before queueing. Invalid/expired tokens are cleared. Page unloading sends a stop but does not consentedly leave the held seat. Explicit shutdown/leave and final room closure clear the saved token. Tokens are never placed in QR URLs.

## Verification and remaining handoff

Unit tests cover the normalized contract and reconnection races. A real Colyseus fixture exercises matchmaking, binary input, six clients, fx, results, reconnect, and automatic requeue. Browser checks exercise a full client and reload restoration against that fixture.

The integrated client was also checked against this repository's actual backend: six humans in one match, binary movement, action effects, reload seat recovery, a full 60-second round, authoritative results, and automatic requeue. Physical phone testing remains pending.
