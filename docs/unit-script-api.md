# Unit script API

Skynet writes one script per unit type. Every unit of that type runs its own instance of the script.
The script decides what to do. The engine decides how well the body does it.

## Runtime

- Sandbox: QuickJS (via `quickjs-emscripten`), one context per unit, no access to host globals, no
  network, no timers, no `Date`, no `Math.random`. Same runtime in the browser and in the Node simulator.
- Tick rate: 10 Hz per unit. The engine executes the last intent smoothly at the game's logic rate.
- Fuel: 10,000 interpreter operations per tick. On exhaustion the tick is aborted, the unit keeps its
  previous intent for that tick, and `fuelExhausted` increments in telemetry.
- Memory: 256 KB per context. `mem` is a plain JSON-serializable object capped at 4 KB after each tick.
- Errors: a thrown error switches that unit to the built-in default script for the rest of the wave.
  The error text and the unit id go to Skynet as a `script_error` event.
- Determinism: `sense.time` and `sense.rand()` come from the engine. The simulator and the live game
  produce the same decisions for the same seed and inputs.

## Module shape

```js
// Skynet submits this source. It runs as an ES module with one required export.
export function tick(self, sense, act, mem) {
  // Return value is ignored. Set intents through `act`.
}
// Optional: called once when the unit spawns.
export function init(self, mem) {}
```

## `self`

```ts
{
  id: string,
  type: "scout" | "endo" | "heavy" | "t1000" | "hkaerial" | "hktank",
  hp: number, maxHp: number,
  pos: {x, y, z}, yaw: number,           // yaw in radians, 0 faces +z
  vel: {x, y, z}, flying: boolean, altitude: number,
  weapon: { ready: boolean, range: number, spread: number, cooldownLeft: number },
  alive: boolean,
  spawnedAt: number,
}
```

## `sense`

Everything here is filtered by the body. Nothing is omniscient.

```ts
{
  time: number,                             // seconds since wave start
  rand(): number,                           // seeded [0, 1)
  flying: boolean,                          // true for HK-Aerial
  altitude: number,                         // flyer root height; zero for ground units
  player: null | {                          // null unless in the vision cone, in range, and unoccluded
    pos: {x, y, z}, dist: number, vel: {x, y, z},
    facingMe: boolean,                      // player looks within 30 deg of this unit
    hp: number, armor: number,              // visible: the HUD state is "known" to Skynet
    weapon: string, reloading: boolean,
  },
  lastKnownPlayer: null | { pos: {x, y, z}, t: number },   // decays after 10 s
  allies: Array<{ id, type, pos, hp, alive }>,             // all living units, always known (Skynet net)
  sounds: Array<{ kind: "gunshot" | "footstep" | "reload" | "explosion", pos, t }>,  // last 2 s, in hearing range
  messages: Array<{ from: string, t: number, data: any }>, // broadcasts from allies, last 2 s
  nav: {
    canSee(pos): boolean,                   // line of sight from this unit's eyes
    pathTo(pos): null | { next: {x, y, z}, dist: number },
    coverNear(pos, fromPos, radius): null | {x, y, z},
    randomPoint(radius): {x, y, z},
    gates: Array<{ id, pos }>, doors: Array<{ id, pos, locked }>,
  },
}
```

`nav` calls cost fuel: `canSee` 200, `pathTo` 800, `coverNear` 1200, `randomPoint` 100.

## `act`

Intents persist until replaced. The engine applies the body limits: turn rate, reaction delay, spread,
weapon cooldown, and spin-up.

```ts
{
  moveTo(pos): void,        // ground units pathfind; flyers move directly in three dimensions
  stop(): void,
  face(pos): void,          // turns at the unit's turn rate
  fire(): void,             // fires if ready and facing within spread of the aim point
  aimAt(pos): void,         // sets the aim point; fire() uses it
  melee(): void,            // Scout and T-1000
  crouch(on: boolean): void,
  say(text: string): void,  // 40 chars max, shows as a subtitle near the unit, 1 per 5 s
  broadcast(data: any): void,   // to allies' sense.messages, 512 bytes max, 2 per s
}
```

For flyers, `moveTo({x, y, z})` clamps `y` to 3.5 through 6 meters. The engine tests full-body
clearance against map colliders and ceilings. A flyer does not enter or query the ground navigation grid.

Weak parts remain spatial hit regions. A script uses `act.aimAt(pos)` and cannot submit a trusted part
name. The engine resolves the hit part. Read `unit_catalog.types[type].parts` for valid names and
damage multipliers. HK-Aerial has a 2x `Turret`. HK-Tank has a rear 3x `Core`. Neither has a head.

## Default scripts

The engine ships one default script per unit type. They are plain, readable, and shown to Skynet in the
rules message as a starting point. The Scout charges the last known position and circles behind. The
Endo advances between cover points and bursts when the player is visible. The Heavy walks straight,
spins up on sight, and suppresses the last known position. The T-1000 closes for melee. HK-Aerial
orbits at 12 through 25 meters. HK-Tank advances slowly and fires its cannon and twin plasma burst.

## Versioning

Each accepted script gets a rev number per unit type per match. The unit nameplate shows it, for
example "T-800 rev 7". Skynet may submit a script at any time. It applies to units that spawn after
acceptance. Acceptance means: parses, exports `tick`, and passes a 5 s smoke run in the simulator with
no thrown errors.
