# Game design: MVP numbers

All numbers here are the starting tune. They live in one data file in code (`core/data/*.json` or
equivalent) so the built-in Skynet, the lobby rules message, and the trader all read the same values.

## Setting

Los Angeles, 2029, after Judgment Day. Night. The human holds a resistance supply bunker. The palette is
blue-gray steel and concrete, orange fire light, and red terminator eyes in the dark. Rain optional.

## Map: "Bunker 7" (one map)

An 84 by 60 metre compound. The original 60 by 60 metre layout remains at its centre.
The footprint grows from 3,600 to 5,040 square metres, or 40 percent.

- Central courtyard: the original truck, rubble, barrels, north building, balcony, and trader remain.
- East loading dock: the original containers and ramp remain. Two wall openings connect the new east yard.
- West service loop: two seven-tread stairs descend 3.5 metres below the new west yard.
  The 31.4 metre service floor has a 2.6 metre choke, pipes, drainage, local mist, and an equipment alcove.
  The two mouths return to different sides of the courtyard. The original west access tunnel also remains.
- Barracks Block C: a 10 by 20 metre block has ground and upper corridors, eight field beds, and three ground entrances.
  Window apertures pass shots. Six-tread stair flights reach the 3.2 metre upper floor and 6.4 metre roof.
  Each tread rises 0.5 metres. The final landing adds 0.2 metres. Roof parapets provide cover.
- Covered yard link: an 18 by 6 metre canopy joins the northeast yard to Block C.
  Ten concrete columns provide cover. Local work lights identify the route.
- Perimeter shells: a motor depot, pump house, and stores block interrupt lateral sightlines.
- Added cover: eight paired supply chests, five sandbag groups, four generators, four cable spools, and one rubble bank.
- Nine spawn gates: N1, N2, E1, S1, S2, W1, E2, W2, S3.
  E1 and W1 move to the new outer boundary. E2 and W2 cover the added yards.
  S3 has a seven metre aperture, 4.8 metre shutter, and `tags: ["boss"]` for the shared boss contract.
- Four existing lockable doors and three existing light switches keep their ids and rules.
  Fourteen added practical lights follow those switches. Four pooled local point lights remain active at most.
  Supply caches add one shared point light, 4 m range and no shadows, that follows the crate nearest the
  player. One light per crate cost about half the frame rate and washed the colonnade ceiling green.
  The crate glow itself comes from the emissive material and bloom.
- Two added fire barrels join the original courtyard fires.
- Four low fog areas, three steam vents, two damaged cable emitters, and pooled dust add local atmosphere.
  The existing fires, rain, skyline smoke, and two configurable hazard slots remain.
- The original south flank wall and resistance trader keep their existing rules.

All extension colliders use `exp_` ids and `area: "expansion"` in `lib/core/data/map.json`.
New slabs store actual hole geometry as compound shapes, so bullets and grenades also pass through stair openings.
The nav coverage test opens switchable doors before checking reachability. Locking the original balcony door still isolates that balcony.
Source photographs and game reference frames stay under `docs/reference/` and do not ship.

## Human

- Health 100. It resets to 100 at each wave clear. Armor 0 to 100, bought at the trader. Armor absorbs 60% of damage until it is gone.
- Move 5 m/s. Sprint 7.5 m/s for a stamina of 6 s, recovers in 4 s. Crouch. No jump in MVP.
- Six numbered weapon slots plus knife and grenades. Reloads retain rounds already in the magazine.
- Headshots deal 2x damage. T-1000 head hits deal 1.5x. HK vehicles have no head region.

Weapons:

| Slot | Weapon | Damage | Rate | Mag | Reserve | Spread | Reload | Price | Ammo |
|------|--------|--------|------|-----|---------|--------|--------|-------|------|
| 1 | Rebuilt Revolver | 50 | 2.5/s | 6 | 66 | 1.2 deg | 2.6 s | start | 6 |
| 2 | M4 rifle | 30 | 11/s | 30 | 240 | 2 deg | 1.8 s | 400 | 20 |
| 3 | Pump shotgun | 12 x 8 | 1.2/s | 8 | 48 | 7 deg | 2.4 s | 550 | 25 |
| 4 | Plasma rifle | 90 | 3/s | 20 | 100 | 1 deg | 2.1 s | 1500 | 80 |
| 5 | M14 Marksman | 220 | 1.2/s | 10 | 60 | 0.2 deg | 2.6 s | 1100 | 60 |
| 6 | M79 Launcher | 260 in 3.5 m | 1/s | 1 | 20 | 0.5 deg | 2.2 s | 1400 | 60 |
| G | Frag grenade | 250 in 4 m | | 1 | 4 | | | 40 each | |
| K | Knife | 40 | 2/s | | | | | start | |

The sniper penetrates two units. Each continued hit retains 60 percent of the previous damage.
The launcher fires 32 m/s shells. A shell arms after 2.5 meters and detonates on contact.
The revolver starts with 6 loaded rounds and 66 reserve rounds. Body hits kill a Scout in 3 shots and an Endo in 6 shots.

Currency is Scrap. The player starts with 400. Terminators drop Scrap on death: Scout 12, Endo 130,
Heavy 350, T-1000 400, HK-Aerial 350, and HK-Tank 1500. Every wave clear pays 150.
A medkit heals 50 for 100 Scrap. Armor costs 2 Scrap per point.

## Units (Skynet's catalog)

| Unit | HP | Speed | Attack | Damage | Reaction delay | Turn rate | Spread | Vision | Cost |
|------|----|-------|--------|--------|----------------|-----------|--------|--------|------|
| T-600 Scout | 60 | 7 m/s | melee at 1.5 m | 3 per hit, 1 per s | 150 ms | 360 deg/s | | 110 deg, 30 m | 12 |
| T-800 Endo | 300 | 3.5 m/s | plasma rifle, 3-shot burst | 15 per shot | 250 ms | 180 deg/s | 3 deg | 110 deg, 40 m | 100 |
| T-800 Heavy | 900 | 2 m/s | minigun, 1 s spin-up | 8 per shot, 12 per s | 400 ms | 90 deg/s | 6 deg | 100 deg, 45 m | 300 |
| T-1000 | 900 | 5.5 m/s | blade at 1.6 m | 35 per hit, 0.7 s | 150 ms | 300 deg/s | | 120 deg, 40 m | 320 |
| HK-Aerial | 500 | 7 m/s | two-bolt burst | 20 per bolt | 200 ms | 220 deg/s | 2 deg | 160 deg, 50 m | 260 |
| HK-Tank | 6000 | 1.6 m/s | cannon and twin bolts | 60 shell, 12 bolt | 350 ms | 55 deg/s | 1 deg | 140 deg, 50 m | boss |

Body limits are enforced by the engine, never by the script. Reaction delay is the gap between a new
stimulus and the first actuation that responds to it. Hearing: gunshots 60 m, footsteps 12 m, reloads
10 m. The Heavy's chest plates halve frontal body damage. Its back spine takes 2x.

The T-1000 regenerates 20 HP each second after three damage-free seconds. It resists all stagger.
The HK-Aerial flies between 3.5 and 6 meters. It orbits targets between 12 and 25 meters.
The HK-Tank's rear Core takes 3x damage. Its boss health uses the difficulty health multiplier.

All ranged enemies fire simulated projectiles. Endo and Heavy rounds travel 30 m/s for two seconds.
Plasma bolts travel 18 m/s. Tank shells travel 22 m/s, use gravity, and splash within 2.5 meters.

Max alive is 32 solo and 44 with three players. One newly unlocked large unit can exceed the 40-percent
type cap, which guards specials only. Later copies cannot. The Scout is the common: it is cheap, it is
weak on its own, and the director buys it by the dozen. A player who stands still and never fires dies
to the first mob in 8 to 20 s, measured by `tools/measure-pacing.mjs`.

## Waves and budget

Ten waves. Wave N base budget is 300 + 120 N. The applied budget is base times a performance multiplier
between 0.9 and 1.1, computed from the last wave: health lost, time to clear, and damage taken per
minute. The multiplier and the budget are always visible on the HUD.

Whatever the submitted config does not spend becomes the in-wave reservoir, which the director spends on
mobs, specials, wanderers, and the end-of-wave rush. Mobs are rare and loud: one every 30 to 60 s. A
wanderer trickle holds a small standing crowd on the map between them. See `docs/director-design.md`. A wave ends when the
reservoir is empty and every unit is dead. Time cap 4 minutes, then remaining units abandon their scripts
and rush. Intermission is 15 s. The trader is open in intermission only, when every enemy is dead. The player
can end the intermission early with a Ready action.

Wave 10 is the extraction finale. The chopper lands 180 s in; only then does standing on the pad end the
match, with every living player within 6 m of it.

Wave 1 unlocks Scout and Endo. Wave 2 unlocks Heavy. Wave 3 unlocks HK-Aerial. Wave 4 unlocks T-1000.
Waves 5 and 10 add one HK-Tank boss. Wave 10 is the finale.

Map knob costs per wave: activate spawn gate 0 (max 3 active), lock or unlock a door 30, cut a light
zone 40, fog level 0 to 3 at 20 per level, place a hazard 60, break the flank wall 150 (one time).

Spawn groups: Skynet submits a list of groups. Each group has a time offset from wave start, a gate,
a unit type, and a count. Units spawn 0.5 s apart within a group.

## Sandbox

Open `https://terminator.app.blitz.dev/sandbox` to enter the single-player testing mode.
The player has full health, full armor, infinite Scrap, and an always-open trader.
The wave director starts paused. Use the panel to spawn units, control waves, and supply weapons.
Press F1 to show or hide the panel.

## Weapons range

Append `&range=1` to a dev editor URL and press Play. Use `?range=1` when no query exists.
`/range/` forwards to `/?range=1`. The range starts directly, without the match menu.
The south courtyard contains 10 m, 20 m, and 40 m target stations and six reactive steel plates at 15 m.
Station distances measure east from the firing line. The aim ruler reports the actual ray distance.
Each station supplies all six unit types. All three HK-Tanks use the 40 m wide lane.
HK-Aerials stay at 4 m altitude. Dummy brains never move or attack.
Dead targets respawn at their saved positions after 120 simulation ticks, with a short flash.
The player has sandbox protection, infinite Scrap, and infinite reserve ammunition and grenades.
Magazine reloads keep their normal duration. Disable Magazine reloads to retain loaded rounds.

F1 toggles the range panel. Both panels remain available with `?range=1&sandbox=1`.
The range keeps the director paused. It supports all eight weapons, instant equipment, and a single-shot button.
Time controls select 1x, 0.25x, 0.1x, or Pause. Step advances exactly one 60 Hz tick while paused.
The same ticks drive simulation, weapon animation, muzzle effects, tracers, projectiles, weather, ragdolls, and camera springs.
Inspect uses the existing held rig. Drag to orbit, scroll to zoom, and select idle, fire, reload, or aim loops.
Player View returns to the unchanged player position and direction.
Diagnostic paths retain the last 20 shots for three simulation seconds. Projectile paths follow their sampled flight.
Impact marks, frozen peak muzzle light, hitbox wireframes, and the distance ruler have separate switches.
Steel plates ring and swing without adding gameplay colliders or damage rules.
Night, Overcast, and Noon change only the yard key light and exposure. The existing sky and weather remain.
Respawn Targets resets the fixture. Clear Shots clears diagnostic paths and player tracer trails.
This mode prepares visual iteration. It does not replace the existing weapon models or animations.

## Telemetry captured per wave

- Player path as a polyline sampled at 4 Hz, and a 2 m grid heatmap of time spent.
- Damage taken events: time, amount, unit type, attacker position, player position, player facing,
  and whether the player was facing the attacker.
- Kills: time, unit type, weapon, distance, headshot flag, time from first damage to death.
- Shots fired and hits per weapon. Reloads with the magazine fraction at reload time.
- Health and armor over time at 1 Hz. Trader purchases.
- Per unit: lifetime, cause of death, distance traveled, shots fired, damage dealt, script errors, and
  fuel exhaustion count.
- Per type: spawned and killed totals for all six types. Summaries mark boss phases and the finale.
- Time to clear, and the wave's applied budget and knobs.

## Dossier

Skynet keeps a dossier per player name. It holds free-text markdown and a list of traits, each with a
key, a value, and a confidence between 0 and 1. The player reads it on the post-match screen. Skynet may
also send short taunts during a match. They show on the HUD as Skynet transmissions.

## Fallback Skynet

If no agent is connected, or the agent misses a deadline, the built-in Skynet acts. It uses simple
heuristics: spend the budget on a mix that counters the player's most used weapon, activate the gates
nearest the player's most camped cell, and cut the lights in that zone every third wave. The HUD shows
"SKYNET: BUILT-IN" or "SKYNET: <agent name>" at all times, and a fallback count.
