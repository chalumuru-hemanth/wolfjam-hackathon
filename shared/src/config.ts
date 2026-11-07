/**
 * Every number you may want to tune lives here. Server, bots and the practice
 * mode all read these, so a tuning pass only touches this file.
 */

export const GAME_IDENTITY = {
  name: "Nightlight",
  theme: "Visibility",
  verb: "flash",
  tagline: "To score, you must be seen.",
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

/** Who can see whom. The server enforces this, so it cannot be cheated around. */
export const LIGHT = {
  /** Anyone this close is visible to you, and you are visible to them. */
  sightRadius: 115,
  /** How long flashing lights you up for everyone. This is its price. */
  exposedSeconds: 1.2,
  /** Being hit is brief: long enough to see who was caught, then back to dark. */
  hitExposedSeconds: 0.4,
  /** The final stretch of a round, when every player is revealed. */
  lastLightSeconds: 10,
  /**
   * Fame is light: every point you hold makes you visible from further away,
   * so a leader can be watched by players it cannot see.
   *
   * Off by default. In 1,000 simulated rounds, a glow of 2 per point helped
   * holders (58.5% wins, up from 52.7%) and cut hidden positions from 49% to 45%.
   * Bots cannot test whether humans enjoy it, so turn it on for a playtest with 2.
   */
  glowPerPoint: 0,
  /** The furthest a glow can reach beyond normal sight. */
  maxExtraGlow: 200,
} as const;

/** The light that pays points and gives you away. */
export const BEACON = {
  radius: 110,
  holdSeconds: 10,
  /** How long before it moves that the next spot is announced. */
  warnSeconds: 3,
  pointsPerSecond: 2,
  lastLightMultiplier: 1.5,
  /** Keeps the beacon away from walls, so it can be approached from any side. */
  margin: 170,
  /** Each move is far enough that nobody can simply wait for it. */
  minJump: 520,
} as const;

/** The verb. Its reach beats sight, so you can flash into the dark on a hunch. */
export const ACTION = {
  cooldownSeconds: 3.2,
  radius: 175,
  knockback: 780,
  stunSeconds: 0.6,
  /** After being hit you cannot be hit again, which prevents stun chains. */
  immuneSeconds: 1.8,
  /** Flat reward for landing a tag. */
  tagPoints: 2,
  /** Share of the victim's score taken, which keeps a leader catchable. */
  stealFraction: 0.15,
} as const;

export const BOTS = {
  /** Bots rethink at this rate, then hold that input between decisions. */
  decisionsPerSecond: 10,
  /** Below 1 stops bots firing the verb the instant they are in range. */
  actionChancePerDecision: 0.06,
  /** Random sideways drift, so bots do not walk in perfect straight lines. */
  wanderJitter: 0.35,
  /** How far outside the light a lurking bot waits. */
  lurkDistance: 120,
} as const;
