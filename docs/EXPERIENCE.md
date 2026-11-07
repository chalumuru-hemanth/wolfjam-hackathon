# Nightlight: play together, disappear together

The hook: **Get rich in the light. Rob them in the dark.** The existing moving beacon, score-stealing flash, and Last Light finale remain the game. This pass makes those choices readable and makes playing together reliable.

## Visual direction

Ink #101827, darkness #05070D, paper #F4F7FC, signal cyan #36D6D0, rival coral #FF746C, spotlight gold #FFC857. Keep locally bundled Barlow Condensed for game identity and scores; DM Sans for actions and readable instructions. The memorable visual is a gold spotlight revealing eye-shaped player tokens. Avoid a dashboard of identical cards: a primary match action, a quieter friends action, and always-available solo practice form the home hierarchy.

    identity + concise hook       spotlight vignette
    Quick match                  phone QR / join link
    Play with friends
    Solo practice
    light earns / flash steals / Last Light reveals

On phones this becomes one column, with play actions before the vignette. Lobby codes, copy/share, errors, and host controls must fit at 320px. Keep the existing Exit and simultaneous two-thumb controls.

The initial approach of treating every mode and statistic as an equal neon card was rejected: it hides the central choice to enter the light. The spotlight gets the visual emphasis; controls stay quiet, direct, and accessible. Reduced motion disables decorative movement.

## Functional scope

- Quick match keeps the existing public queue and bot fill.
- Solo practice works independently of server availability, using the shared simulation and bots.
- Friends use a six-character invite code or link, a private lobby, host-controlled round starts, host migration, bot fill, and return to the same lobby between rounds.
- The arena remains authoritative and hidden positions remain filtered. Invitations never expose arena reservation secrets or reconnect tokens.
- Existing disconnect cleanup, safe areas, keyboard controls, sound unlock, and Exit remain required.
- No accounts, persistent friends database, chat, shops, or additional action buttons.

## Validation

Strict types, unit checks, production build, public matchmaking regression, private host/join/start/leave/rejoin/error flows, offline solo launch, desktop and phone layouts, and two browsers through the phone-access HTTPS endpoint. Physical phone play remains a separate handover check.

The user confirmed the new invite/QR flow on a real laptop and phone: both joined and played together. Automated checks additionally cover full private rounds, reload recovery, host migration, six-player capacity, guest start rejection, offline reload, gateway fallback, and cleared invites when changing modes. A delayed-seat regression found and fixed incomplete initial arena snapshots; CI now runs the friends smoke script against the production container.
