# Nightlight: Game Design

**Theme:** Visibility

**The one rule:** To score, you must be seen.

## The game

The arena is dark. You can see yourself, and anyone close to you. Everyone else is gone.

A single beacon burns somewhere in the dark. Standing in its light pays points, but it lights you up for the whole arena. Hidden players can creep up and flash you, stealing what you earned.

The round lasts 60 seconds, and the most points wins.

## The rules

| Rule | Detail |
|---|---|
| **Sight** | You see anyone within 115 px, and they see you. Sight is mutual, so no one gets a free look |
| **The beacon** | A 110 px pool of light. Pays 2 points a second to everyone inside, and exposes them to the whole arena |
| **It moves** | Every 10 seconds it jumps at least 520 px. The next spot is announced 3 seconds early |
| **Flash** | Your one verb. It tags anyone within 175 px for 2 points plus 15% of their score |
| **The cost** | Flashing lights you up for everyone for 1.2 seconds, hit or miss, with a 3.2 second cooldown |
| **Being tagged** | You are stunned, shoved, and shielded from further tags for 1.8 seconds |
| **Last Light** | In the final 10 seconds, everyone is revealed and the beacon pays 1.5x |

## Why it fits the theme

Visibility is the score, the risk and the weapon at once. A theme can easily end up as just dark art with a normal game underneath. Here, removing visibility would leave no game:

- **Being seen is how you earn.** There is no way to score in the dark except by flashing, which exposes you anyway.
- **Being unseen is how you hunt.** Darkness is the only protection, and it pays nothing.
- **Every action costs visibility.** A player is always choosing how much of themselves to reveal.

The `HIDDEN` and `EXPOSED` label on screen is the most important readout in the game, because that is the state you are playing.

## Decisions from research

**Hiding alone is boring.** Hide-and-seek players report that once hidden, there is nothing left to do but wait. The moving beacon prevents this: it forces everyone to keep crossing the dark, and sitting still earns nothing.

**Tension between two goals is what makes hidden-information games work.** Staying safe and earning points are here directly opposed, and the player resolves that conflict every few seconds.

**Hidden movement needs a release.** A long stretch without information can end in an unsatisfying surprise. Last Light is that release: everything is revealed, and the round ends in an open fight where everyone can see what is at stake.

**Flash reaches further than sight.** This creates the signature play: you suspect someone is just beyond the edge of your vision, and you gamble a flash into the dark. A hit is a great moment. A miss lights you up for nothing.

**Stealing keeps leaders catchable.** The steal is a percentage, so the player ahead is the most valuable target. Combined with public scores, that makes the leader a hunted player rather than an untouchable one.

## Tuning

`scripts/balance.ts` plays thousands of rounds with the real rules and bots and no server. It shaped this design more than any other tool. The first version looked reasonable on paper and failed badly in simulation:

| Measure | First version | Now | Goal |
|---|---|---|---|
| Positions hidden before Last Light | 18% | **49%** | About half |
| Seat fairness, same bot style in every seat | Unmeasured | **23% to 26%** | Equal |
| Flashes per round | 60 | **32** | A real decision |
| Rounds that change hands in Last Light | 72% | **57%** | Close, not random |

What fixed it:

- **The dark barely existed.** Each tag exposed its victim for as long as a flash exposes the flasher. At 60 hits a round, players spent about 30% of their time lit up through no choice of their own. Being hit now exposes you for 0.4 seconds, while choosing to flash still costs 1.2.
- **Joining first was an advantage.** Flashes resolved in join order, and a tag cancelled the victim's flash. Flashes in the same tick now all land, starting from a random player.
- **Flashing was too cheap.** A longer cooldown and calmer bots made it a choice rather than a reflex.

These figures are from 1,200 rounds with 4 players. Results stay close at 6 players, with 53% of positions hidden. Two gaps remain:

- **Bots that hold the light beat bots that lurk, about 60% to 40%.** This may say more about how simple the lurking bots are than about the rules, but it is unresolved.
- **Two-player rooms are less interesting.** Only 42% of positions stay hidden, because the two players meet at the beacon so often.

These numbers come from bots, which are not people. They show the rules are not broken, but only human play can show that the game is fun.

## What to tune by feel

These are all in `shared/src/config.ts`:

- `LIGHT.sightRadius`: raise it if the dark feels confusing, lower it if it feels safe.
- `ACTION.cooldownSeconds`: lower it if players feel they rarely get to act.
- `BEACON.holdSeconds`: lower it if holding the light feels static.
- `BOTS.actionChancePerDecision`: raise it if bots feel harmless.

## Research sources

- [Marathon: Networking and Security](https://bungie.net/7/en/News/Article/marathonsecurity), on server-side fog of war limiting wall hacks
- [Kartograph](https://www.ieee-security.org/TC/SP2011/PAPERS/2011/paper032.pdf), on why client-side fog can be read from memory
- [Colyseus StateView](https://docs.colyseus.io/state/view), the per-client filtering used here
- [Hunter vs. Hunted](https://www.skeletoncodemachine.com/p/hunter-vs-hunted), on the risks of hidden movement
- [Hide and Seek Update](https://forum.playhive.com/t/hide-and-seek-update/12402), on hiding turning into waiting
