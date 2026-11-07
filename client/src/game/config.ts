import { ACTION, ARENA, BEACON, GAME_IDENTITY, LIGHT, ROUND } from '@wolfjam/shared/config';

/** Rule numbers come from shared, so the client can never disagree with the server. */
export const GAME = {
  title: GAME_IDENTITY.name,
  tagline: GAME_IDENTITY.tagline,
  actionLabel: 'FLASH',
  objective: 'Stand in the light to score. Flash to steal. Both give you away.',
  roundMs: ROUND.playSeconds * 1000,
  countdownMs: ROUND.countdownSeconds * 1000,
  actionCooldownMs: ACTION.cooldownSeconds * 1000,
  actionRadius: ACTION.radius,
  sightRadius: LIGHT.sightRadius,
  beaconRadius: BEACON.radius,
  arena: { width: ARENA.width, height: ARENA.height, radius: ARENA.playerRadius },
} as const;
export const COLORS = { night: 0x05070d, navy: 0x101827, grid: 0x161f2e, cyan: 0x36d6d0, coral: 0xff746c, gold: 0xffc857, white: 0xf4f7fc } as const;
