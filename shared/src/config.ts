/**
 * Every number you may want to tune lives here. Server and bots read these,
 * so a tuning pass only touches this file.
 */

/** Fill these in when the theme is out. They show up on /ops and in the docs. */
export const GAME_IDENTITY = {
  name: "Untitled Arena",
  theme: "TBD",
  verb: "pulse",
} as const;

export const NET = {
  tickRate: 30,
  /** State patches per second. Clients interpolate between them. */
  patchRate: 20,
  maxBufferedInputs: 16,
} as const;

export const ROUND = {
  countdownSeconds: 3,
  playSeconds: 60,
  resultsSeconds: 8,
  /** How long a new room waits for reserved players before starting anyway. */
  joinTimeoutSeconds: 4,
  reconnectSeconds: 10,
} as const;

export const MATCH = {
  maxPlayers: 6,
  /** A match that timed out in the queue is topped up with bots to this size. */
  targetPlayers: 4,
  queueTimeoutMs: 5000,
  loopIntervalMs: 250,
} as const;

export const ARENA = {
  width: 1600,
  height: 900,
  playerRadius: 28,
} as const;

export const MOVE = {
  maxSpeed: 340,
  acceleration: 2600,
  friction: 1800,
} as const;

/**
 * Placeholder verb: a radial pulse that knocks nearby players back and scores
 * a point per player hit. Replace with the real verb in sim.ts `resolveAction`.
 */
export const ACTION = {
  cooldownSeconds: 1.2,
  radius: 170,
  knockback: 780,
  stunSeconds: 0.35,
  pointsPerHit: 1,
} as const;

export const BOTS = {
  /** Bots rethink at this rate, then hold that input between decisions. */
  decisionsPerSecond: 10,
  /** Below 1 stops bots firing the verb the instant they are in range. */
  actionChancePerDecision: 0.45,
  /** Random sideways drift, so bots do not walk in perfect straight lines. */
  wanderJitter: 0.35,
} as const;
