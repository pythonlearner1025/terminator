# Game design: MVP numbers

All numbers here are the starting tune. They live in one data file in code (`core/data/*.json` or
equivalent) so the built-in Skynet, the lobby rules message, and the trader all read the same values.

## Setting

Los Angeles, 2029, after Judgment Day. Night. The human holds a resistance supply bunker. The palette is
blue-gray steel and concrete, orange fire light, and red terminator eyes in the dark. Rain optional.

## Map: "Bunker 7" (one map)

A 60 by 60 meter compound. Parts:

- Central courtyard with rubble cover, a wrecked truck, and two burning barrels (orange light sources).
- A two-story building on the north side with a balcony that overlooks the courtyard and interior stairs.
- A loading dock on the east side with shipping containers for cover.
- A service tunnel on the west side, narrow, with a door at each end.
- Six enemy spawn gates around the perimeter: N1, N2, E1, S1, S2, W1. Skynet picks which are active.
- Four lockable doors: tunnel west, tunnel east, building ground floor, building balcony.
- Three light zones Skynet can cut: courtyard floods, building interior, dock lamps.
- Two hazard slots: courtyard center and dock ramp. Hazard types: electrified floor, steam vent.
- One breakable flank wall on the south side, closed at match start.
- The trader is a resistance supply crate on the ground floor of the building. It opens in intermission.

## Human

- Health 100. It resets to 100 at each wave clear. Armor 0 to 100, bought at the trader. Armor absorbs 60% of damage until it is gone.
- Move 5 m/s. Sprint 7.5 m/s for a stamina of 6 s, recovers in 4 s. Crouch. No jump in MVP.
- Four weapon slots plus knife and grenades. Reload with a mag drop (no partial mag saving in MVP).
- Headshots on terminators deal 2x damage. Body shots on a Heavy's chest plates deal 0.5x.

Weapons:

| Slot | Weapon | Damage | Rate | Mag | Reserve max | Spread | Price | Ammo price per mag |
|------|--------|--------|------|-----|-------------|--------|-------|--------------------|
| 1 | 9mm pistol | 25 | 6 per s | 15 | 120 | 1.5 deg | start | 5 |
| 2 | M4 rifle | 30 | 11 per s | 30 | 240 | 2.0 deg | 400 | 20 |
| 3 | Pump shotgun | 12 x 8 pellets | 1.2 per s | 8 | 48 | 7.0 deg | 550 | 25 |
| 4 | Plasma rifle | 90 | 3 per s | 20 | 100 | 1.0 deg | 1500 | 80 |
| G | Frag grenade | 250 in 4 m | | 1 | 4 | | 40 each | |
| K | Knife | 40 | 2 per s | | | | start | |

Currency is Scrap. The player starts with 400. Terminators drop Scrap on death: Scout 50, Endo 130,
Heavy 350. Every wave clear pays 150. A medkit heals 50 for 100 Scrap. Armor costs 2 Scrap per point.

## Units (Skynet's catalog)

| Unit | HP | Speed | Attack | Damage | Reaction delay | Turn rate | Spread | Vision | Cost |
|------|----|-------|--------|--------|----------------|-----------|--------|--------|------|
| T-600 Scout | 120 | 7 m/s | melee at 1.5 m | 25 per hit, 1 per s | 150 ms | 360 deg/s | | 110 deg, 30 m | 40 |
| T-800 Endo | 300 | 3.5 m/s | plasma rifle, 3-shot burst | 15 per shot | 250 ms | 180 deg/s | 3 deg | 110 deg, 40 m | 100 |
| T-800 Heavy | 900 | 2 m/s | minigun, 1 s spin-up | 8 per shot, 12 per s | 400 ms | 90 deg/s | 6 deg | 100 deg, 45 m | 300 |

Body limits are enforced by the engine, never by the script. Reaction delay is the gap between a new
stimulus and the first actuation that responds to it. Hearing: gunshots 60 m, footsteps 12 m, reloads
10 m. The Heavy's chest plates halve frontal body damage. Its back spine takes 2x.

Max alive at once: 24. Unit caps per wave: at most 40% of budget on one type. From wave 3 on, at least
two types.

## Waves and budget

Ten waves. Wave N base budget is 300 + 120 N. The applied budget is base times a performance multiplier
between 0.8 and 1.5, computed from the last wave: health lost, time to clear, and damage taken per
minute. The multiplier and the budget are always visible on the HUD.

A wave ends when every unit is dead. Time cap 4 minutes, then remaining units abandon their scripts and
rush. Intermission is 45 s. The trader is open only in intermission. The player can end the intermission
early with a Ready action.

Map knob costs per wave: activate spawn gate 0 (max 3 active), lock or unlock a door 30, cut a light
zone 40, fog level 0 to 3 at 20 per level, place a hazard 60, break the flank wall 150 (one time).

Spawn groups: Skynet submits a list of groups. Each group has a time offset from wave start, a gate,
a unit type, and a count. Units spawn 0.5 s apart within a group.

## Telemetry captured per wave

- Player path as a polyline sampled at 4 Hz, and a 2 m grid heatmap of time spent.
- Damage taken events: time, amount, unit type, attacker position, player position, player facing,
  and whether the player was facing the attacker.
- Kills: time, unit type, weapon, distance, headshot flag, time from first damage to death.
- Shots fired and hits per weapon. Reloads with the magazine fraction at reload time.
- Health and armor over time at 1 Hz. Trader purchases.
- Per unit: lifetime, cause of death, distance traveled, shots fired, damage dealt, script errors, and
  fuel exhaustion count.
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
