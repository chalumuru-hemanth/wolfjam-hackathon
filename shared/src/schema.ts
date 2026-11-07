import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * Network state. Built with schema() rather than decorators so nothing here
 * needs compiler flags. The Phaser client should not import this at runtime:
 * the SDK rebuilds these classes from the join handshake. `import type` is fine.
 *
 * Who a player is and where a player is live in separate schemas on purpose.
 * PlayerState goes to everyone and holds no position. BodyState holds the
 * position, and the server only sends it to clients allowed to see that player.
 */
export const PlayerState = schema(
  {
    handle: t.string(),
    kind: t.string(),
    score: t.uint16().default(0),
    connected: t.boolean(),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const BodyState = schema(
  {
    /** Whole pixels: enough for interpolation and much cheaper to sync. */
    x: t.int16(),
    y: t.int16(),
    actionReady: t.boolean(),
    stunned: t.boolean(),
    /** Lit up for the whole arena right now. */
    exposed: t.boolean(),
    /** Recently tagged, and cannot be tagged again yet. */
    shielded: t.boolean(),
  },
  "BodyState",
);
export type BodyState = SchemaType<typeof BodyState>;

/** Facts only this player may know about themselves. */
export const SelfState = schema(
  {
    /** How many other players can see you right now, bots included. */
    watchers: t.uint8().default(0),
  },
  "SelfState",
);
export type SelfState = SchemaType<typeof SelfState>;

export const ArenaState = schema(
  {
    phase: t.string(),
    secondsLeft: t.uint8(),
    players: t.map(PlayerState),
    /** Filtered per client. A hidden player simply has no entry here. */
    bodies: t.map(BodyState).view(),
    /** Filtered per client. Each client only ever receives its own entry. */
    selves: t.map(SelfState).view(),
    beaconX: t.int16(),
    beaconY: t.int16(),
    /** Equal to beaconX and beaconY until the next spot is announced. */
    beaconNextX: t.int16(),
    beaconNextY: t.int16(),
    beaconMovesIn: t.uint8(),
    /** Final stretch: everyone is revealed and the beacon pays double. */
    lastLight: t.boolean(),
  },
  "ArenaState",
);
export type ArenaState = SchemaType<typeof ArenaState>;

export const WaitState = schema({ waiting: t.uint16() }, "WaitState");
export type WaitState = SchemaType<typeof WaitState>;

export const PartyMember = schema({ handle: t.string(), connected: t.boolean() }, 'PartyMember');
export type PartyMember = SchemaType<typeof PartyMember>;
export const PartyState = schema({ code: t.string(), hostId: t.string(), phase: t.string(), members: t.map(PartyMember) }, 'PartyState');
export type PartyState = SchemaType<typeof PartyState>;

/** One client input frame. Must stay flat: primitives only. */
export const InputFrame = schema(
  {
    moveX: t.float32(),
    moveY: t.float32(),
    action: t.boolean(),
  },
  "InputFrame",
);
export type InputFrame = SchemaType<typeof InputFrame>;
