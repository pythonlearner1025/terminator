# Architecture

## Folder layout

```text
assets/       Saved Kite3D scene files
generators/   Deterministic stopped-mode previews and unit templates
lib/core/     Headless simulation, data, default brains, waves, and HUD projection
lib/view/     Kite3D and threepipe adapters
lib/ui/       HTML and CSS HUD
scripts/      Kite3D Object3D components
test/core/    Node tests for the headless simulation
tools/        Reproducible scene and benchmark commands
```

## Module boundaries

`lib/core/` is the authority for gameplay. It uses plain ES modules. It imports no code from
`threepipe`, `@kite3d/engine`, or the DOM. It runs in Node 20 or newer without a browser shim.

`lib/view/` reads core state and creates visual objects. Runtime roots are outside
`viewer.scene.modelRoot`. `RuntimeObjectOwner` owns every runtime root and clone. The adapters do not
decide damage, movement limits, AI reactions, waves, or economy rules.

`lib/ui/hud.js` renders one view-model. It contains no game rules. It owns and removes its style and
root DOM nodes.

`scripts/GameManager.script.js` is the integration point. It owns the fixed-step accumulator, the
World, the wave director, the views, input, and HUD. `start()` first calls `stop()`. `stop()` removes
all runtime resources and restores the saved camera.

The saved scene is only changed by `npm run scene`, which runs `tools/build-scene.mjs`.

## World step contract

`new World({map, units, weapons, brains, seed})` creates deterministic state. Defaults come from
`lib/core/data/`. `world.players` is a `Map` in join order. The host is created with id `player` and
remains available through the compatibility getter `world.player`. `world.addPlayer({id, name})`
adds up to three players and returns the new state. `world.removePlayer(id)` returns whether a player
was removed.

`world.step(inputsByPlayer)` advances exactly one tick at 60 Hz. The bundle is keyed by player id.
A legacy plain input record applies to the host. Missing player ids reuse that player's last absolute
input. The step moves every player, advances their weapon timers, runs unit brains at 10 Hz, applies
body limits, updates attacks and hazards, samples aggregate and per-player telemetry, and increments
`world.tick` once. It does not read wall clock time. The same seed, starting state, and input bundles
produce the same event log.

The replay buffer is `world.replay`. It contains one normalized keyed bundle for every completed tick.
Ghost replay extracts the host record and also accepts legacy single-player records.

Health, armor, ammo, weapons, grenades, scrap, reloads, and purchases belong to each player.
`world.purchase(item, playerId)` defaults to the host for old callers. Player attacks carry a
`playerId`, so kill scrap and telemetry go to the shooter. Unit vision, hearing, melee, and hitscan
consider every living player.

`world.snapshot()` returns plain JSON state, including keyed players and `playerOrder`, units,
projectiles, map state, phase and wave timers, scaling, deterministic RNG state, replay and prior
inputs, telemetry, and an `events` delta. `eventStart` and `eventCursor` identify that delta.
`world.applySnapshot(snapshot)` replaces prediction and render state and appends the event delta.
`world.predictPlayer(playerId, inputs)` advances only that player's movement fields by one 60 Hz tick
without advancing world time, AI, combat, events, or telemetry.

At each wave start, `WaveDirector` selects connected-player scaling: one player uses budget `1.0`,
health `1.0`, and max alive `24`; two use `1.6`, `1.35`, and `30`; three use `2.1`, `1.7`, and `36`.
The budget multiplier is applied after the performance multiplier. The selected block is exposed by
director state, rules, wave summaries, snapshots, and the view-model. A cleared wave heals and pays
every living player. Dead players keep their loadout and respawn with full health at the next wave.
The match ends only when every connected player is dead before a wave clears.

## Vertical surfaces and navigation

`map.json.walkable` describes which existing collider boxes provide footing. A `top` surface uses the
collider's upper face. A `stairTread` uses the collider center plus `heightRules.stairTreadOffset`, so
the six riser boxes produce 0.5 m tread increments without changing their geometry. A `ramp` surface
linearly interpolates its height along the declared axis. `movementHoles` identify the stairwell where
the second-floor slab remains a sight blocker but is not a movement ceiling.

`NavGrid` samples every declared surface at each horizontal grid cell. Each sample is a separate node,
so ground, upper-floor, balcony, dock, and connector nodes can share an x/z cell. Cardinal and same-cell
neighbors connect only when their height difference is at most `walkable.maxStep`. Static and dynamic
blockers are tested against the node's vertical body interval. This makes each locked door block only
the level its box overlaps. A* returns `{x, y, z}` points, and unit path following takes its foot height
from the current walkable surface. Failed paths and changed goals retain the World's 2 Hz re-path cap.

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

`aim` defaults to false, including older replay and ghost records. Hold the right mouse button
to aim; only the left button fires. Firearms aim only outside reloads and quick knife/grenade
actions. Aiming uses `weapons.json.aim`: 35% base spread, 60% movement speed, and no sprint.
The view-model's `weapon.aiming` and `weapon.spread` expose effective aim and hitscan spread in
degrees. The legacy `crosshair.spread` also reports that spread; the HUD draws no crosshair.

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
  alive,
  spawnedAt,
}
```

`sense` has this shape:

```js
{
  time,
  rand(),
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
  wave: {current, total, remaining, phase, timer, budget, multiplier},
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
4. Add a template node in `tools/build-scene.mjs`.
5. Extend `generators/unit-template.generator.js` and the template lookup in `lib/view/units.js`.
6. Add combat, validation, determinism, and view-model tests.

## Add a weapon

1. Add the complete tune to `lib/core/data/weapons.json`.
2. Add the weapon id to `slots` when it occupies a numbered slot.
3. Extend World only if the weapon has behavior that existing hitscan, pellet, melee, or grenade paths
   cannot express.
4. Add the placeholder view geometry in `lib/view/player.js`.
5. Add combat and telemetry tests.

No map, unit, or weapon number belongs in the view or HUD.

## Later workstream ownership

- W3 map visuals owns `generators/map.*` and `lib/view/map*`.
- W4 enemies owns `generators/unit*` and `lib/view/units*`.
- W5 sandbox owns `lib/core/sandbox/`.
- W6 and W7 director and simulator own `lib/core/waves*` and `lib/core/sim/`.
- W8 server owns `server/` and `packages/`.
- W10 HUD owns `lib/ui/`.

Core data remains shared authority. Cross-workstream changes to `lib/core/data/`, `lib/core/world.js`, or
the contracts above need matching tests and an architecture update.
