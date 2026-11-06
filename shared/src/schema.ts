import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * Network state. Built with schema() rather than decorators so nothing here
 * needs compiler flags. The Phaser client should not import this at runtime:
 * the SDK rebuilds these classes from the join handshake. `import type` is fine.
 */
export const PlayerState = schema(
  {
    handle: t.string(),
    kind: t.string(),
    /** Whole pixels: enough for interpolation and much cheaper to sync. */
    x: t.int16(),
    y: t.int16(),
    score: t.uint16(),
    actionReady: t.boolean(),
    stunned: t.boolean(),
    connected: t.boolean(),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const ArenaState = schema(
  {
    phase: t.string(),
    secondsLeft: t.uint8(),
    players: t.map(PlayerState),
  },
  "ArenaState",
);
export type ArenaState = SchemaType<typeof ArenaState>;

export const WaitState = schema({ waiting: t.uint16() }, "WaitState");
export type WaitState = SchemaType<typeof WaitState>;

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
