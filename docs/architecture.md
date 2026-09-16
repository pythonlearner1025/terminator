# Architecture

## Folder layout

```text
assets/       Saved scenes, textures, reusable map pieces, and placed unit models
lib/core/     Headless simulation, data, waves, the in-wave director, and HUD projection
lib/core/brains/ Native unit brains, including the enraged mob brain
lib/view/     Kite3D and threepipe adapters
lib/ui/       HTML and CSS HUD
scripts/      Kite3D Object3D components
test/core/    Node tests for the headless simulation
tools/        Reproducible asset, scene, texture, and benchmark commands
tools/lib/    Build-only figure and glTF export libraries
```

## Module boundaries

`lib/core/` is the authority for gameplay. It uses plain ES modules. It imports no code from
`threepipe`, `@kite3d/engine`, or the DOM. It runs in Node 20 or newer without a browser shim.

`lib/view/` reads core state and creates visual objects. Each view adds its own runtime root to
`viewer.scene`, outside `viewer.scene.modelRoot`, and removes it in `stop()`. The adapters do not
decide damage, movement limits, AI reactions, waves, or economy rules.

`lib/ui/hud.js` renders one view-model. It contains no game rules. It owns and removes its style and
root DOM nodes.

`scripts/GameManager.script.js` is the integration point. It owns the fixed-step accumulator, the
World, the wave director, the views, input, and HUD. `start()` first calls `stop()`. `stop()` removes
all runtime resources and restores the saved camera.

`tools/build-scene.mjs` creates missing map placements and preserves existing placement transforms.
The editor can then save human transform, visibility, name, replacement, and deletion changes.

## Placed unit assets

`npm run build:assets` builds all textures, map assets, unit assets, and range assets.
It runs `tools/build-scene.mjs` last. The unit builder uses deterministic source geometry with
Three.js materials. It exports each unit through
`GLTFExporter`, reads the result through glTF Transform, and writes text glTF plus an external buffer.

Each unit lives under `assets/models/units/<type>/` as `<type>.gltf` and `<type>.bin`. Enemy files
contain named high and far figures. The soldier file contains its named high figure. Textures remain
under `assets/textures/units/` and `assets/textures/roster/`; the glTF files reference those shared
files instead of copying image bytes.

`assets.json` assigns each asset an id such as `unit-endo` and maps every virtual glTF resource to a
project file. Scene wrappers use `extras.rootPath: "/kite3d/@unit-endo/endo.gltf"`, an empty
`sProperties` list, and `rootPathOptions.createUniqueNames: false`. The format follows
`@kite3d/engine/src/runtime/nestedAssets.ts` and `@kite3d/engine/src/runtime/projectFormat.ts`.

The runtime nested-asset loader caches each import and attaches its children to the named scene
wrapper. `UnitView` clones the placed high figure and shares its far geometry for distance LOD.
Skeleton clones rebind to cloned bones by stable names before animation, gore, and ragdoll binding.
The menu clones the same placed Endo. `PlayersView` clones the placed Resistance Soldier.
Runtime code never calls a unit generator.

## World step contract

`new World({map, units, weapons, brains, seed})` creates deterministic state. Defaults come from
`lib/core/data/`. `world.players` is a `Map` in join order. The host is created with id `player` and
remains available through the compatibility getter `world.player`. `world.addPlayer({id, name})`
adds up to three players and returns the new state. `world.removePlayer(id)` returns whether a player
was removed.

`world.step(inputsByPlayer)` advances exactly one tick at 60 Hz. The bundle is keyed by player id.
A legacy plain input record applies to the host. Missing player ids reuse that player's last absolute
input. The step moves every player, regenerates their health, advances their weapon timers, runs unit
brains at 10 Hz, applies body limits, updates attacks and hazards, steps supply caches, samples
aggregate and per-player telemetry, and increments `world.tick` once. It does not read wall clock
time. The same seed, starting state, and input bundles produce the same event log.

A player who took no damage for 5 seconds regenerates 4 health per second up to 40. Regeneration
never passes 40. Medkits and the wave-clear heal are unchanged. `player.lastDamagedAtTick` is the
clock; a snapshot without it reads as never damaged.

Any damage above zero staggers a common for 0.25 s. Specials keep the old rule: 65 damage or more
staggers for 0.4 s. A knife hit on a common staggers it 0.6 s and pushes it 2.5 m away. A shotgun
shot that lands 4 or more pellets on one common pushes it 1.5 m. A push is `unit.knockback`, spends
0.3 s, overrides the brain's move intent, and stops at colliders.

The replay buffer is `world.replay`. It contains one normalized keyed bundle for every completed tick.
Ghost replay extracts the host record and also accepts legacy single-player records.

Health, armor, ammo, weapons, grenades, scrap, reloads, and purchases belong to each player.
`world.purchase(item, playerId)` defaults to the host for old callers. Player attacks carry a
`playerId`, so kill scrap and telemetry go to the shooter. Unit vision, hearing, melee, and projectile
targeting consider every living player.

`world.snapshot()` returns plain JSON state, including keyed players and `playerOrder`, units,
projectiles, map state, phase and wave timers, scaling, deterministic RNG state, replay and prior
inputs, telemetry, and an `events` delta. It also carries `director`, `traderOpen`, `extraction`,
`pickups`, and `traderSpotId`. Units carry `enraged`, `wanderer`, `knockback`, and
`lastSeenByPlayerTick`. Players carry `lastDamagedAtTick`. An older snapshot without these reads as
a closed trader, an empty pacer, and undamaged players.
`eventStart` and `eventCursor` identify that delta.
`world.applySnapshot(snapshot)` replaces prediction and render state and appends the event delta.
`world.predictPlayer(playerId, inputs)` advances only that player's movement fields by one 60 Hz tick
without advancing world time, AI, combat, events, or telemetry.

`world.setSandbox(options)` controls deterministic testing rules. Invulnerability keeps the host at
full health and armor. Infinite Scrap fixes its balance at 999999 and bypasses purchase deductions.
Sandbox state survives snapshots, and sandbox wave summaries carry `sandbox: true`.
The optional `infiniteAmmo` flag retains host reserve ammunition and grenades.
Its `noReload` option retains loaded rounds and prevents reloads. Defaults preserve normal matches.

`lib/core/range.js` owns the range layout, loadout commands, fixed-tick respawns, and time admission.
`spawnUnit(type, pos, {brain: "dummy"})` creates a stationary native brain with no sensor or attack work.
Snapshots preserve that brain selection. Range hitscan shot events add `paths` with the authoritative
pellet directions and impact points. These optional records do not consume randomness or change damage.
`RangeClock` changes how many 60 Hz steps the manager admits. It never changes `World.step` duration.
`lib/ui/range.js` mounts only for `range=1`. `lib/view/range.js` owns visual plates and debug overlays.
The inspector uses the existing weapon rig, material projection, and animation state.
Range targets and props are runtime-only because range mode is not part of Bunker 7.
Their reusable glTF files live under `assets/models/range/` and are registered in `assets.json`.
`lib/view/range-props.js` loads and places those files outside `modelRoot` during Play.
It creates no visible geometry, and Stop removes every placed range node.

All ranged enemy attacks are fixed-tick entries in `world.projectiles`. Rounds and bolts fly straight.
Tank shells use gravity and splash damage. Swept map and player-capsule tests prevent tunneling.
Player launcher shells sweep against the fitted map primitives and named unit-part volumes.
`projectile_fired` and `projectile_hit` expose deterministic lifecycle events. Snapshots retain active
projectiles and their sequence counter, so guests and replay continuations see identical trajectories.
Event records reserve `type` for the event name. Their projectile subtype uses `projectileType`.

Grenades are fixed-tick entries in `world.projectiles`. A throw emits `grenade_thrown`, advances with
gravity and swept sphere collision against active map colliders, emits `grenade_bounce` for audible
impacts, and emits `explosion` at the projectile position after a 2.5 second fuse. Explosion events
include the configured radius and a hit list. Damage falls off linearly to zero at that radius for
units and every living player, including the thrower and teammates.

At each wave start, `WaveDirector` selects connected-player scaling: one player uses budget `1.0`,
health `1.0`, and max alive `32`; two use `1.6`, `1.35`, and `38`; three use `2.1`, `1.7`, and `44`.
The budget multiplier is applied after the performance multiplier. The selected block is exposed by
director state, rules, wave summaries, snapshots, and the view-model. A cleared wave heals and pays
every living player. Dead players keep their loadout and respawn with full health at the next wave.
The match ends only when every connected player is dead before a wave clears.

Roster validation unlocks Heavy on wave 2, HK-Aerial on wave 3, and T-1000 on wave 4. Waves 5 and 10
require one zero-cost HK-Tank at the 8-meter boss gate. The final wave carries the finale flag.

## In-wave director

`WaveDirector` runs an in-wave pacer beside the legacy wave schedule. `new WaveDirector(world, {pacer})`
takes `pacer: true` by default. `pacer: false` drops the pacer, the population, and the deck, so a test
that drives a `spawns` list alone keeps the old behavior. `docs/director-design.md` holds the tune and
every number. The pacer changes how often threats arrive. It never changes their strength.

`lib/core/director.js` owns `Pacer`. It keeps one intensity number per living player and takes the team
maximum. It walks four states: `build_up`, `sustain_peak`, `peak_fade`, and `relax`. It spends the wave
reservoir only in the first two. `beginWave`, `spend`, `refund`, `releaseReserve`, and `drain` move the
reservoir. Each state change emits `director_state`. The trader is open only during intermission.

`lib/core/population.js` owns spawn selection and the population functions. `spawnCandidates` joins
`map.spawnGates` and `map.spawnSpots`. `spotIsValid` rejects a spot closer than 12 m to any living
player, or one any living player can see. `spotIsBehind` tests the spot against the nearest player's
yaw. `Population` schedules mobs, specials, wanderers, the end-of-wave rush, and the straggler rule,
and pays for each out of the reservoir. `Deck` deals one wave event card per wave from a shuffled list
and never deals the same card twice in a row.

`lib/core/pickups.js` owns supply caches. `world.pickups` is a `Pickups` instance. `plan(wave, rng)`
picks four of the twelve `map.cacheSpots`, one weapon, one armor, one ammo, and one grenades cache.
When the player owns every weapon, the weapon cache becomes an ammo cache.
`step(world)` gives a cache to any player within 1.2 m and emits `cache_taken`. `snapshot()` and
`applySnapshot()` carry the active list to guests.

`lib/core/brains/enraged.js` is the mob brain. World refreshes `lastKnownPlayer` to the nearest living
player on every brain tick of an enraged unit, so the brain only moves, faces, and attacks.
`world.resolveUnitBrain(unit)` picks it for any unit with `unit.enraged`, including after a snapshot
and after a script error.

The director pass adds these `World` members:

```js
world.spawnUnit(type, pos, {yaw, rev, id, brain, enraged, alerted, wanderer})
world.enrageUnit(unitId)          // switch a living unit to the enraged brain
world.despawnUnit(unitId)         // silent removal: no unit_death, no scrap, telemetry causeOfDeath 'despawned'
world.unitSeenByAnyPlayer(unit)   // eye-to-eye sight inside a 100 degree cone around the player's yaw
world.setTraderSpot(spotId)       // move the trader collider, rebuild navigation, emit trader_moved
world.director                    // {state, intensity, reservoir, reservoirMax}, written every tick
world.traderOpen                  // boolean; true only in intermission. purchase() accepts it or intermission
world.extraction                  // null or {pos, phase, timer}
world.pickups                     // Pickups instance
```

`enraged` gives the unit the enraged brain. `alerted` sets `lastKnownPlayer` to the nearest living
player at spawn. `wanderer` marks the unit for the despawn and refund rule and tracks
`unit.lastSeenByPlayerTick` at 2 Hz.

The director emits `director_state`, `mob_incoming`, `special_dispatched`, `stragglers_enraged`,
`deck_card`, `trader_moved`, `cache_spawned`, `cache_taken`, and `extraction`. Audio, camera feel, the
HUD, and telemetry read them from the event log.

## Vertical surfaces and navigation

`map.json.walkable` describes which placed collider assets provide footing. A `top` surface uses the
collider's upper face. A `stairTread` uses the collider center plus `heightRules.stairTreadOffset`, so
the six riser boxes produce 0.5 m tread increments without changing their geometry. A `ramp` surface
linearly interpolates its height along the declared axis. `movementHoles` identify the stairwell where
the second-floor slab remains a sight blocker but is not a movement ceiling.

`lib/core/collision.js` resolves colliders into deterministic box, oriented-box, cylinder, or sphere
primitives. Compound `shapes` use local offsets from the authored center. Movement, navigation,
sight, hitscan, and grenade sweeps query the same primitives. The trader joins the static collider
set when it declares `navBlock` or `blocksSight`.

Unit types declare pose-specific `hitVolumes` in `units.json`. The core selects idle, aim, or Scout
melee volumes from deterministic intent. Named head volumes cause headshots. Other volumes cover the
visible torso and limbs without treating the complete character bounds as solid.
T-1000 reuses Endo volumes. HK-Aerial and HK-Tank use measured asset hull and weak-part volumes.

`NavGrid` samples every declared surface at each horizontal grid cell. Each sample is a separate node,
so ground, upper-floor, balcony, dock, and connector nodes can share an x/z cell. Cardinal and same-cell
neighbors connect only when their height difference is at most `walkable.maxStep`. Static and dynamic
blockers are tested against the node's vertical body interval. This makes each locked door block only
the level its box overlaps. A* returns `{x, y, z}` points, and unit path following takes its foot height
from the current walkable surface. Failed paths and changed goals retain the World's 2 Hz re-path cap.

HK-Aerial bypasses `NavGrid`. It flies directly between 3.5 and 6 meters. Each candidate step tests
its clearance sphere against active colliders, floors, walls, and indoor ceilings.

Bunker 7 extension records use `exp_` collider ids and `area: "expansion"`.
`assets/main.scene.gltf` owns all visual map placement transforms.
`map-piece-registry.json` owns local collider shapes for each reusable asset.
`map.json` owns surfaces, gates, doors, switches, hazards, starts, fog, vents, and sparks. It also
owns `cacheSpots`, `traderSpots`, `spawnSpots`, and `extraction`. Those carry no geometry, so no scene
placement moves them; `lib/core/map.js` copies them to `{id, pos, yaw}` records for every reader.
`lib/core/map.js` applies scene transforms to registry shapes before creating `World` and `NavGrid`.
The same ordered placements always create the same collider array.
`MapView` reads the derived map and owns pooled atmosphere.
The expanded slabs use compound box shapes around stair holes. The same shape data serves shots, grenades, and movement.
The tunnel sits at y = -3.5. Block C uses ground, y = 3.2, and y = 6.4 walkable layers.
All new unit routes have Scout and Heavy traversal tests, including body clearance at turns.
Axis-aligned box queries reject footprint misses before allocating primitives. Equivalent compound-box tests preserve query semantics.
Nav rebuilds filter collider candidates by cell bounds before testing exact shapes, preserving collider order and the footprint tolerance.
An exhaustive comparison checks every layer against the original full collider scan, including closed doors and rotated compound fixtures.
Each rebuild clears the neighbor cache. Path searches cache immutable lists on first use and preserve the original neighbor order.
Edit mode shows every nested asset root separately.
Play hides those roots and merges static descendants by material into runtime batches.
Doors, gates, hazards, fixtures, flank blocks, and the trader remain separate runtime clones.
Stop removes all batches and clones, then restores every placed root.
Static material batches retain albedo, normal, roughness, metalness, and AO maps.
`kite3d.viewer.camera` sets the stopped viewer camera. Scene generation uses the same position and target for the named overview camera.

## Input schema

```js
{
  move: {x: number, z: number},
  yaw: number,
  pitch: number,
  fire: boolean,
  aim: boolean,
  reload: boolean,
  switchTo: null | number | string,
  sprint: boolean,
  crouch: boolean,
  jump: boolean,
  grenade: boolean,
  melee: boolean,
  ready: boolean,
}
```

All fields describe the current tick. They are not deltas. `move.x` is right. `move.z` is forward.
Yaw and pitch are radians. Yaw zero faces positive Z. The browser adapter turns key and mouse events
into this record. `jump` is a one-tick pulse and defaults to false for older records.
Keys 5 and 6 select the sniper and launcher. The wheel cycles owned weapons only.
Wheel input uses `switchTo: "next" | "previous"`; direct slot inputs remain numbers.

`aim` defaults to false, including older replay and ghost records. Hold the right mouse button
to aim; only the left button fires. Firearms aim only outside reloads and quick knife/grenade
actions. Aiming uses `weapons.json.aim`: 35% base spread, 60% movement speed, and no sprint.
The view-model's `weapon.aiming` and `weapon.spread` expose effective aim and hitscan spread in
degrees. The legacy `crosshair.spread` also reports that spread. `lib/ui/crosshair.js` draws four
short lines that open with that spread. The Crosshair setting mounts it and is off by default.

## Unit brain contract

A brain exports `tick(self, sense, act, mem)`. It may also export `init(self, mem)` for the later
sandbox workstream. The current default brains are native modules behind the same interface.

`self` has this shape:

```js
{
  id, type,
  hp, maxHp,
  pos: {x, y, z},
  yaw,
  vel: {x, y, z},
  weapon: {ready, range, spread, cooldownLeft},
  alive, flying, altitude,
  spawnedAt,
}
```

`sense` has this shape:

```js
{
  time,
  rand(),
  flying,
  altitude,
  player: null | {
    pos, dist, vel, facingMe, hp, armor, weapon, reloading,
  },
  players: [{id, pos, dist, vel, facingMe, hp, armor, weapon, reloading}],
  lastKnownPlayer: null | {id, pos, t},
  allies: [{id, type, pos, hp, alive}],
  sounds: [{kind, pos, t}],
  messages: [{from, t, data}],
  nav: {
    canSee(pos),
    pathTo(pos),
    coverNear(pos, fromPos, radius),
    randomPoint(radius),
    gates: [{id, pos}],
    doors: [{id, pos, locked}],
  },
}
```

`act` has this shape:

```js
{
  moveTo(pos),
  stop(),
  face(pos),
  fire(),
  aimAt(pos),
  melee(),
  crouch(on),
  say(text),
  broadcast(data),
}
```

Intent persists until a later brain tick changes it. World enforces reaction delay, turn rate, spread,
weapon cooldown, burst cadence, and Heavy spin-up. A brain never bypasses those body rules.
Flyer `moveTo` consumes its full three-dimensional target without requesting a navigation path.

## View-model contract

`projectViewModel(world, playerId)` returns one render-only snapshot for that player. Omitting
`playerId` selects the host:

```js
{
  tick,
  health: {value, max, ratio, low, critical},
  armor: {value, max, ratio},
  ammo: {mag, reserve, capacity, low, empty},
  weapon: {id, name, slot, reloadProgress, reloading},
  wave: {current, total, remaining, phase, timer, budget, multiplier, boss, finale, traderOpen},
  director: {state, intensity, reservoir, reservoirMax, traderOpen},
  extraction: null | {pos, phase, timer},
  boss: null | {name, hp, hpMax},
  skynet: {status, connected, fallbackCount, revs},
  scrap,
  grenades,
  sprintStamina,
  teammates: [{id, name, hp, health, armor, distance, alive, downed}],
  scaling: {players, budgetMultiplier, unitHealthMultiplier, maxAlive},
  crosshair: {spread, reloadProgress},
  killFeed: [{id, text, age}],
  hitMarkers: [{id, kind}],
  damageDirections: [{id, angle, strength, age}],
  nameplates: [{id, label, rev, hp, maxHp, ratio, distance, pos, chatter}],
  transmission,
}
```

The HUD may format or animate these fields. It must not change the World.

## Add a unit type

1. Add its body numbers and cost to `lib/core/data/units.json`.
2. Add a default brain under `lib/core/brains/` and register it in `lib/core/world.js`.
3. Extend validation or body attack handling only when the new body needs a real new rule.
4. Add a unit asset specification to `tools/build-unit-assets.mjs`.
5. Add its placed asset wrapper in `tools/build-scene.mjs` and `lib/view/units.js`.
6. Register its glTF, buffer, and texture mappings in `assets.json` through the asset build.
7. Add combat, validation, determinism, asset round-trip, and view-model tests.

## Add a weapon

1. Add the complete tune to `lib/core/data/weapons.json`.
2. Add the weapon id to `slots` when it occupies a numbered slot.
3. Extend World only if the weapon has behavior that existing hitscan, pellet, melee, or grenade paths
   cannot express.
4. Add the first-person rig in `lib/view/weapons.js` and its animation in `lib/view/weapons-animation.js`.
5. Add combat and telemetry tests.

`lib/view/projectiles.js` renders authoritative round, bolt, shell, and grenade entries without changing core state.

No map, unit, or weapon number belongs in the view or HUD.

## Later workstream ownership

- Map visuals own `assets/models/map/`, `lib/view/map*`, and `tools/build-map-assets.mjs`.
- W4 enemies owns `assets/models/units/`, `tools/lib/*-figure.js`, `lib/view/units*`, and `tools/build-unit-assets.mjs`.
- W5 sandbox owns `lib/core/sandbox/`.
- W6 and W7 director and simulator own `lib/core/waves*` and `lib/core/sim/`.
- W8 server owns `server/` and `packages/`.
- W10 HUD owns `lib/ui/`.

Core data remains shared authority. Cross-workstream changes to `lib/core/data/`, `lib/core/world.js`, or
the contracts above need matching tests and an architecture update.
