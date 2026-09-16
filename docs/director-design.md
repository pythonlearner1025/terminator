# Director design (branch `pass/director`)

This is the contract for the in-wave director pass. Every agent on this branch builds against it.
Numbers here are the starting tune. Put them in code as named constants or data, never as magic numbers.

Source of the ideas: Michael Booth, "The AI Systems of Left 4 Dead" (GDC 2009). Core rule from that
talk: the director changes the frequency of threats, not their amplitude.

## Scope

In:
- An in-wave pacer with an intensity meter and four states: build up, sustain peak, peak fade, relax.
- A budget reservoir that the pacer spends over the wave: mobs, specials, wanderers, an end-of-wave rush.
- Spawn selection out of view, mostly behind the player.
- The scout becomes the cheap common. Max alive rises to 32.
- Commons flinch on every hit. Knife and shotgun shove commons.
- An enraged brain for mobs with look-ahead path following and separation.
- Player health regenerates to a floor of 40.
- View-only hit-stop. A crosshair setting, default off.
- Twelve cache spots, four active per wave, glowing green. The trader moves each wave.
- Interior spawn spots. A wave 10 extraction finale.
- Sounds, taunts, and HUD cues for every director verb.

Out, by owner decision:
- Survivor bots. Revive or last stand. Dead co-op players still wait for the next wave. Solo death still ends the match.
- Mob climbing or vaulting.
- The external Skynet agent protocol. `docs/skynet-protocol.md`, `packages/skynet-client`, `packages/skynet-mcp`, and `server/` do not change. Configs an external agent submits today must still validate and run.

## Vocabulary

- Reservoir: the wave budget that the pacer spends over the wave.
- Intensity: a per-player number that estimates excitement. Team intensity is the max over living players.
- Common: a unit with `role: "common"` in `units.json`. Today that is only the scout.
- Special: `role: "special"`: endo, heavy, hkaerial, t1000. Boss: `role: "boss"`: hktank.
- Mob: a group of enraged commons that runs at the players.
- Wanderer: a unit that spawned dazed and uses its default brain.
- Enraged: a unit that always knows the nearest living player and runs at it.
- Alerted: a unit whose `lastKnownPlayer` was set at spawn.
- Spot: a spawn position. Gates from `map.spawnGates` plus interior `map.spawnSpots`.
- Deck: a shuffled list of wave event cards, one dealt per wave.

## Numbers

Units (`lib/core/data/units.json`). Only the scout changes.

| Field | Scout before | Scout after |
|---|---|---|
| role | none | common |
| cost | 40 | 12 |
| hp | 120 | 60 |
| damage | 25 | 3 |
| cooldown | 1 | 1 |
| scrap | 50 | 12 |

A common does 3 damage a second, about what a Left 4 Dead common does on Normal. It is cheap, weak alone,
and dangerous in a crowd. A player who stands still and never fires dies to the first mob in 8 to 20 s.
That death time is a sanity check, not a design goal: a longer one only buys a harmless swing.

All other units get `role: "special"`, the HK-Tank gets `role: "boss"`. No other unit number changes.

Max alive: `units.json.maxAlive` 24 to 32. `COOP_SCALING` in `waves.js`: 24, 30, 36 become 32, 38, 44.

Stagger. Commons stagger 0.25 s on any damage above zero. Specials keep the current rule: 65 damage or more, 0.4 s.

Shove. A knife hit on a common staggers it 0.6 s and pushes it 2.5 m away from the player over 0.3 s.
A shotgun shot that lands 4 or more pellets on one common pushes it 1.5 m over 0.3 s. Pushes stop at colliders.

Player regeneration. When the player took no damage for 5 s, hp regenerates 4 per second up to 40. Regeneration never passes 40. Medkits and the wave-clear reset are unchanged.

Budget. `waveBudget` base stays `300 + 120 * wave`. The performance multiplier clamps to 0.9 through 1.1 instead of 0.8 through 1.5. Co-op and difficulty multipliers are unchanged.

Intermission. 45 s becomes 15 s. R still skips it. Heal to 100 and the 150 Scrap pay are unchanged.

Intensity, per living player:

| Input | Change |
|---|---|
| `player_damage` event | plus amount / 100 |
| hp drops below 25 from 25 or more | plus 0.3, once per crossing |
| a unit dies within 16 m of the player | plus 0.1 times (1 minus distance / 16) |
| decay, when not engaged | minus 0.1 per second, applied every tick |
| clamp | 0 through 1.5 |

Engaged means: the player took damage in the last 3 s, or a living unit is within 12 m and has line of sight to the player's eye. Evaluate the line-of-sight part at 2 Hz.

The meter also runs during the intermission, where nothing spawns. Without it a wave that ended hot
opened the next wave in peak fade and relax, and the first mob waited 40 s. The kill radius is 16 m and
the kill gain 0.1 because a player who kills at range still earns a peak; the earlier 10 m and 0.15
peaked twice as often in late waves and never in the first two.

Director states. Team intensity drives transitions.

| State | Spending | Leaves when |
|---|---|---|
| build_up | yes | team intensity reaches 1.0 |
| sustain_peak | yes | a timer of 3 to 5 s expires |
| peak_fade | no | team intensity falls to 0.6, or no unit is alive |
| relax | no | a timer of 15 to 25 s expires |

Every wave starts in build_up. Intensity carries over between waves. The trader is open during intermission only. A relax window sits inside a live wave, so it keeps the trader closed.

Population functions. Timers only advance while the state is build_up or sustain_peak.

| Function | Rule |
|---|---|
| First mob | at 5 to 10 s after wave start |
| Mob interval | 30 to 60 s after the previous mob |
| Mob size | clamp(6 + 2 * wave, 6, min(20, maxAlive minus alive)) |
| Mob cost | size times the common cost. Skip the mob if the reservoir cannot pay for the minimum size |
| Mob spawn | one spot. 75 percent from behind when a behind spot is valid. Units 0.25 s apart, jitter 0.6 m, enraged |
| Endo | every 20 to 40 s, count 1, count 2 from wave 6 |
| Heavy | every 60 to 120 s, count 1, from wave 2 |
| HK-Aerial | every 60 to 120 s, count 1, from wave 3, gate spots only |
| T-1000 | every 90 to 150 s, count 1, from wave 4 |
| Specials | spawn at an unseen spot 15 to 35 m from the nearest player, alerted, cost from the reservoir |
| Wanderers | at wave start, 2 + floor(wave / 2) scouts at unseen spots 25 m or more from every player, dazed, cost from the reservoir |
| Wanderer trickle | during build_up only, hold a standing 3 + floor(wave / 2) living wanderers. Below that, and when the spendable reservoir can pay, place one every 4 s at an unseen spot 20 to 35 m from the nearest player |
| Wanderer despawn | unseen by every player for 20 s and farther than 40 m from every player: remove silently, refund the cost. No refunds after the reservoir hits zero |
| End-of-wave rush | hold back 15 percent of the initial reservoir. When the rest can no longer buy the cheapest thing on the list, a minimum mob or the cheapest unlocked special, spend it at once as a mob from behind |
| Straggler rule | reservoir is zero and 3 or fewer units stay alive for 15 s: enrage all of them, once per wave |
| Unreachable sweep | after the enrage, a living unit that no player has seen for another 30 s is despawned silently, so a wave can always end |
| Boss waves | wave 5 and 10 spawn one HK-Tank at gate S3 at wave start, cost 0, as today. The pacer ignores the boss |
| Time cap | 240 s still forces the rush as today |

Wave end: the reservoir is zero, every scheduled legacy spawn is done, and no unit is alive. Then `finishWave` runs as today.

Spawn selection (`lib/core/population.js`):
- Candidates are `map.spawnGates` plus `map.spawnSpots`. Flyers use gates only.
- A spot is valid when it is 12 m or more from every living player and no living player has line of sight to it. Test the sight line from the player's eye, `pos.y + 1.65`, to the spot at `pos.y + 1.0`, with `world.lineOfSight`.
- A spot is behind the nearest player when the angle between `yawTo(player.pos, spot)` and `player.yaw` is more than 110 degrees. Use `yawTo` and `normalizeAngle` from `lib/core/math.js`.
- Pick uniformly with `world.rng` among the chosen set. Never spawn in view. If no spot is valid, wait one second and try again.

Deck. At match start, shuffle `[lights_out, fog, door_lock, heavy_pair, aerial_patrol, t1000_hunt, nothing]` with `world.rng`. Deal one card per wave. Reshuffle when empty. Never deal the same card twice in a row.

A card is dealt at wave start and fires when its effect lands. `lights_out`, `heavy_pair`, and
`t1000_hunt` fire later in the wave; every other card fires at wave start, in the tick it is dealt.

| Card | Effect | Locked before wave |
|---|---|---|
| lights_out | at the first sustain_peak, turn off the light zone nearest the team | 1 |
| fog | fog level 2 for the wave | 1 |
| door_lock | lock the most used door from the last wave summary, else `tunnel_w` | 2 |
| heavy_pair | two heavies at the second build_up of the wave, cost from the reservoir | 2 |
| aerial_patrol | two HK-Aerials at wave start, cost from the reservoir | 3 |
| t1000_hunt | one alerted T-1000 with the first mob, cost from the reservoir | 4 |
| nothing | nothing | 1 |

A locked card plays as nothing. Knob costs for cards come from the reservoir at the existing knob prices.

Caches (`lib/core/pickups.js`). Twelve `map.cacheSpots`. Four are active per wave, chosen at wave start with `world.rng`: one weapon, one armor, one ammo, one grenades. The weapon cache gives the first weapon the player does not own in the order m4, shotgun, plasma, from wave 1 on. When the player owns all three, it is an ammo cache instead. Armor gives 50. Ammo gives every owned weapon 30 percent of `reserveMax`. Grenades give 2. A player takes a cache by standing within 1.2 m. Every cache glows green.

Trader spots. Four `map.traderSpots`: the current crate position plus three more. Each intermission the director moves the trader to a different spot, never the same twice in a row.

Extraction (wave 10). `map.extraction = {pos, gateId, holdSeconds: 180}`. At wave 10 start emit `extraction` with phase `announced`. Mob intervals on wave 10 are 30 to 50 s. At 180 s emit phase `arrived`, break the flank wall, enrage every living unit, and spawn a free mob of 12 every 20 s from any valid spot. Once the phase is `arrived`, the wave ends with a win as soon as every living player is within 6 m of `map.extraction.pos`, whatever is still alive. Emit phase `complete`. Wave summary `endReason` is `extracted`. Death still ends the match.

Only a landed chopper extracts anybody. The pad is 38 m from the player spawn, so without the phase gate
a player walked onto an empty pad and won wave 10 in one tick.

## Interfaces

New `World` methods and fields. The owner of each is in the ownership table.

```js
world.spawnUnit(type, pos, {yaw, rev, id, brain, enraged, alerted, wanderer})
// enraged: unit.enraged = true and the enraged brain. alerted: lastKnownPlayer = nearest living player.
// wanderer: unit.wanderer = true, tracked by unit.lastSeenByPlayerTick.
world.enrageUnit(unitId)          // switches a living unit to the enraged brain
world.despawnUnit(unitId)         // silent removal: no unit_death, no scrap, telemetry causeOfDeath = 'despawned'
world.unitSeenByAnyPlayer(unit)   // eye to eye line of sight and a 100 degree cone from the player's yaw
world.traderOpen                  // boolean, set by the director. True only in intermission
world.director                    // {state, intensity, reservoir, reservoirMax}, written by the director every tick
world.pickups                     // Pickups instance: plan(wave, rng), step(world), active, snapshot(), applySnapshot()
world.setTraderSpot(spotId)       // moves the trader collider and nav block, rebuilds nav
world.extraction                  // null or {pos, phase, timer}
```

Events. Emit through `world.emit(type, data)` so audio, camera feel, HUD, and telemetry see them.

| Event | Data |
|---|---|
| `director_state` | `{state, wave, intensity, reservoir, reservoirMax}` on every state change |
| `mob_incoming` | `{size, spotId, behind, pos}` once per mob, at the first spawn |
| `special_dispatched` | `{unitType, unitId, spotId, pos}` |
| `stragglers_enraged` | `{count}` |
| `deck_card` | `{card, wave, phase}` with phase `dealt` at wave start and `fired` when the effect lands |
| `trader_moved` | `{id, pos}` |
| `cache_spawned` | `{id, kind, pos}` |
| `cache_taken` | `{id, kind, playerId, pos}` |
| `extraction` | `{phase, pos, t}` with phase `announced`, `arrived`, or `complete` |

View-model additions in `projectViewModel`:

```js
director: {state, intensity, reservoir, reservoirMax, traderOpen},
wave: {..., traderOpen},
extraction: null | {pos, phase, timer},
```

Caches and the trader position are read by the HUD layer straight from `world.pickups.active` and `world.map.trader.pos`, the same way the trader marker works today.

Snapshots. Every new field above must round-trip through `world.snapshot()` and `world.applySnapshot()`, so co-op guests see the same state. Determinism rules stay: use `world.rng`, never `Math.random` or `Date`, in `lib/core`.

Legacy configs. `validateWaveConfig` keeps accepting `spawns` lists. The 40 percent per-type cap applies only to specials. When a config has `spawns`, the director schedules them as today and runs the pacer with the remaining reservoir. `BuiltinSkynet.plan` keeps its signature and returns `{spawns, knobs, population}`. `population` is internal to this branch and never leaves the game.

Taunts. Skynet talks through `world.transmission`, which the HUD ticker already shows. One line per verb, at most one every 8 s:

| Trigger | Line |
|---|---|
| `mob_incoming` with behind true | POSITION KNOWN. UNITS REROUTED. |
| `mob_incoming` with behind false | UNITS INBOUND. |
| `special_dispatched` t1000 | T-1000 DISPATCHED. |
| `deck_card` lights_out with phase `fired` | LIGHTS ARE MINE. |
| `stragglers_enraged` | FINISH THEM. |
| `extraction` announced | EXTRACTION SIGNAL DETECTED. |
| `extraction` arrived | ALL UNITS. TERMINATE. |
| wave summary | CAMPED <zone> <percent>%. ADJUSTING. from the heatmap's hottest zone |

## Ownership

Work only inside `/Users/minjunes/games/terminator-director`. Never edit `/Users/minjunes/games/terminator`.

| Agent | Owns | Also allowed, one marked line each |
|---|---|---|
| director | `lib/core/director.js` new, `lib/core/population.js` new, `lib/core/waves.js`, `lib/core/builtin-skynet.js`, `lib/core/viewmodel.js`, `lib/core/telemetry.js`, `test/core/director/`, wave tests | `world.js`: the purchase gate and the `traderOpen`, `director`, `extraction` snapshot fields. `lib/ui/session.js`: the trader gate condition |
| units | `lib/core/data/units.json`, `lib/core/brains/`, `world.js` unit code: `spawnUnit` options, `tickBrain`, unit movement, `damageUnit` stagger, melee shove, `enrageUnit`, `despawnUnit`, `unitSeenByAnyPlayer`, unit snapshot fields, `test/core/units/`, existing combat tests pinned to scout numbers | none |
| player | `world.js` player damage and heal code, `lib/view/camera-feel.js`, `scripts/GameManager.script.js` update loop, `lib/ui/settings.js`, `lib/ui/crosshair.js` new, `lib/ui/session.js` except the trader gate, `test/core/player/`, `test/ui/crosshair.test.js` | none |
| map | `lib/core/data/map.json`, `lib/core/map.js`, `lib/core/pickups.js` new, `lib/view/map.js`, `lib/view/caches.js` new, `lib/view/extraction.js` new, `scripts/GameManager.script.js` start and stop view mounting, `test/core/map-spots.test.js`, `test/core/pickups.test.js` | `world.js`: construct `this.pickups`, one `this.pickups?.step(this)` call in `step`, `setTraderSpot`, pickup and trader snapshot fields |
| presence | `lib/audio/`, `lib/ui/hud.js`, `lib/ui/presentation.js`, `lib/ui/sfx.js`, `lib/ui/skynet-voice.js` new, `test/ui/presentation.test.js`, `test/audio/` | `scripts/GameManager.script.js`: mount the voice module |

Shared file etiquette: re-read a file right before each edit, edit only your region, and never reformat a file. If a test outside your ownership fails because of another agent's concurrent edit, report it and move on.

## Verification

Each agent adds node tests that fail without its change, runs them, then runs the full suite with `npm test` and reports the counts.

The integration pass adds `tools/measure-pacing.mjs`. It runs the director headless with the built-in Skynet for waves 1 through 10, once with a passive player and once with the sniper ghost from `tools/prove-core-roster.mjs`, and prints per wave: units spawned, mobs, first contact time, peaks, straggler events, combat share, and passive death time.

| Metric | Target | Measured, seed 7 |
|---|---|---|
| Combat share of match time | above 60 percent | 50 percent, NOT MET. See the note below |
| First contact | under 12 s | 9 of 10 passive waves, worst 12.5 s |
| Peaks per wave | 2 to 3 | 8 of 10 waves |
| Straggler hunt | never over 15 s | 0 s |
| Passive player death | 8 to 20 s | 7 of 10 waves |
| Wave 10 | reaches extraction | extracted |
| Core tick at 32 alive, `tools/benchmark-world.mjs` | under 13.3 ms p99 | unchanged by this pass |

Combat share is a bad target as written. It is measured on one seed, and it swings with the seed. Five
seeds, sniper match, invulnerable ghost: with the old mob base of 8 the share read 61, 50, 66, 44 and
49 percent, so three of the five seeds already missed the target before this change. With the mob base
at 6 the same five seeds read 50, 53, 48, 51 and 51 percent. The mob cut costs about 3 points of mean
share and removes most of the swing. Seed 7 looked like a pass because seed 7 was the lucky draw. Fix
the target, not the tune: score the mean of several seeds, and set the number from that mean.

How the tool reads those numbers:

- The passive run starts a fresh match per wave, because a death ends a match and every wave needs its
  own death time. A passive wave is a death probe, not a match, so its combat share is printed for
  reference and never scored: the wave is over in about twenty seconds and the mob needs part of that
  to arrive.
- The sniper run is one match of ten waves. The ghost is invulnerable: an HK-Tank shell kills a
  strafing ghost on wave 5, and the run has to reach wave 10.
- First contact is scored on the passive run. A perfect sniper kills the first mob at forty metres, so
  its own contact time measures the ghost, not the pacer.
- Peaks are scored on the sniper run. An invulnerable ghost takes no damage, so the quiet early waves
  rarely peak: the meter is right, nothing threatened it.
- Waves 7 and 10 kill a passive player fastest. A T-1000 and an HK-Tank do that, and specials are out
  of scope for this tune.

## Known issues

- Two HK-Aerials from the `aerial_patrol` card were once found stacked over a roof, where no player
  could see them and they could not see the player, so the wave could not end. The unreachable sweep
  now closes that wave after 30 s. The flyer behaviour itself is unchanged.
  `lib/core/brains/default-hkaerial.js`.
- Commons were once found parked at y 1.0 in the barracks yard, standing on crates. It does not
  reproduce: one common and a mob of twelve from `barracks_upper` all reach the player, and
  `lookAheadPoint` in `world.js` already drops back to node following at every height change, which is
  stricter than a 0.3 m riser rule. `barracks_upper` stays in `map.spawnSpots`, pinned by a regression
  test in `test/core/units/enraged.test.js`. The unreachable sweep covers a repeat.
