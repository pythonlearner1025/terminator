# HUD and UX spec

## Terse revision

W18 replaces the text treatments below. Barlow, angular panels, scanlines, skull art, colors, and feedback animations stay.

- Main: title, Play, Host, Join, Skynet, Settings, Quit. No dossier anywhere in the UI.
- Host: code, one invite/copy action, roster, readiness icons, override toggle, Start. Join: code/invite and relay inputs, Join; connected players use the roster. Settings: one word per control. Utility navigation uses accessible icon buttons.
- Skynet lobby: code, complete selectable install command/copy, status icon, Start. Pause: Resume and Settings/Menu icons. Quit: Quit and Menu.
- Trader: categories, short item names, prices, scrap balance, bulk ammo/armor icons with prices, countdown. Purchases retain sound, color, and brief error labels.
- HUD: icon/number vitals, numeric ammunition, `WAVE 3/10`, remaining count, `SKYNET · BUILT-IN · 1140`, `E7 S3 H1`, one short transmission line, three icon feed entries. Enemy plates show type, rev and health only. Teammates keep names and health, with armor bars. Spectate keeps the target name and arrow controls. No gameplay hints or chatter subtitles.
- Results: result, wave, kills/accuracy/damage taken/scrap, Play Again. Co-op shows the same four values per player; full names remain. Partial history and unavailable/disconnected data retain accessible labels. Server dossier APIs and core data are unchanged.

Measurements, screenshots, and checks: [W18 evidence](evidence/w18-terse-ui/README.md).

Quality bar: Killing Floor 2. Every element below exists in KF2 or is the Skynet equivalent. The look is
dark, gritty, angular panels, a condensed sans-serif face, subtle scanlines, and high-contrast numbers.
Resistance elements are cool white and blue. Skynet elements are red. Warnings are amber. Everything
is an HTML and CSS overlay on the canvas, driven by a view-model the core exposes each frame. No game
logic lives in the UI.

## In-match HUD

Bottom left, the vitals block:
- Health bar, red fill, big number. Armor bar, blue fill, number. Both animate on change.
- A low-health vignette starts under 35 health and pulses under 20.

Bottom right, the weapon block:
- Weapon name, a line-art weapon icon, magazine count in large type, reserve count in small type.
- The magazine number flashes amber at 25% and red when empty. Grenade count with icon.
- A reload progress ring around the crosshair while reloading.

Top center, the wave block:
- "WAVE 3 / 10" with a bar of terminator icons that empties as the wave is cleared, and the count of
  units remaining.
- In intermission: "TRADER OPEN" and a countdown from 45. A world-space marker with distance points at
  the trader crate. A Ready button hint: "Press R to end intermission early".

Top right, the Skynet panel, red:
- "SKYNET: <agent name>" or "SKYNET: BUILT-IN". A connection dot.
- Budget for the coming wave with the multiplier, for example "BUDGET 1140 (x1.2)".
- Deployed model revs, for example "ENDO r7 · SCOUT r3 · HEAVY r1".
- Fallback count if above zero.
- A transmission ticker for taunts, with a typewriter reveal and a short static burst sound.

Top left, the Scrap counter with a scrap icon, and a kill feed below it (last 5, fade out).

Center:
- A dynamic crosshair that opens with spread and movement.
- Hit marker on hit, a heavier red marker on headshot, a skull tick on kill.
- Damage direction indicators as red arcs at the screen edge pointing at the attacker.
- Unit nameplates when a unit is within 25 m and in view: type, health bar, and rev label such as
  "T-800 rev 7". Skynet chatter from `act.say` shows as a subtitle under the nameplate.

## Trader menu (intermission only, full screen overlay)

- Left column: categories. Weapons, Ammo, Armor, Items.
- Center: the item list with icon, name, price, and for weapons the stats bars (damage, rate, mag).
- Right column: the player's loadout, Scrap balance, "Fill all ammo" with the total price, "Buy full
  armor" with the price, and the time remaining.
- Buying plays a cash sound and flashes the balance. Not enough Scrap shakes the price in red.

## Screens

- Main menu: the T-800 skull from the art reference on the right with red eyes that track the cursor.
  Left: Play, Connect Agent, Dossier, Settings, Quit. Version in the corner.
- Lobby: the lobby code in large type, the MCP install line with a copy button, the agent status line
  that flips from "Waiting for Skynet" to "<agent name> connected", map name, and a Start button.
  Starting without an agent shows "Built-in Skynet will play".
- Pause: Resume, Settings, Quit to menu. The game freezes and blurs behind it.
- Settings: mouse sensitivity, field of view, master, music, and effects volume, quality preset.
- Post-match: result banner (SURVIVED or TERMINATED), wave reached, kills by type, accuracy, damage
  taken, Scrap earned, time. Then the dossier reveal: a red terminal panel that types out Skynet's
  markdown and lists the traits with confidence bars. A Play Again button.

## Feel

- Camera kick on fire, scaled per weapon. Screen shake on Heavy fire nearby and on grenades.
- Hit-stop of 40 ms on headshot kills.
- Wave start: a klaxon, the wave block slams in. Wave clear: a stinger and a Scrap tally.
- Skynet connect: a red static burst and the Skynet panel powers on.
