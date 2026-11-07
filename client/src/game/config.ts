/** Theme-neutral defaults. Replace the presentation and practice rule after theme reveal. */
export const GAME = {
  title: 'Wolfjam Arena',
  actionLabel: 'PULSE',
  objective: 'Move close. Pulse coral sparks.',
  roundMs: 60_000,
  countdownMs: 3_000,
  actionCooldownMs: 650,
  actionRadius: 115,
  arena: { width: 1600, height: 900, speed: 240, radius: 28 },
} as const;
export const COLORS = { navy: 0x101827, cyan: 0x36d6d0, coral: 0xff746c, white: 0xf4f7fc } as const;
