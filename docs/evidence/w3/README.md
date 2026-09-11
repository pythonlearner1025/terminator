# Bunker 7 environment evidence

Built as a fast procedural night-map pass: weathered blue concrete, rusted steel, cold sky illumination, orange fire, red Skynet signals, silhouettes of ruined Los Angeles, and deterministic local canvas textures. This is a stylized first pass toward the requested KF2 mood, not equivalent to KF2's authored asset detail. No downloaded art, collider edits, or scene-file edits were made by this workstream.

## Areas

- Courtyard: cracked concrete, bounded rubble piles, an armored truck wreck with tires and cabin, two burning drums with animated flame cards, coals, embers, smoke and flickering point lights.
- North building: inset sealed windows, ribs, Bunker 7 and Los Angeles stencils, balcony deck, interior tread geometry and a stairwell opening derived from the new `walkable` map data. Ground and balcony door shutters remain in their declared volumes.
- East dock: three ribbed and rusted containers, serial stencils, loading markings, safety edges and a ramp constrained to its collider.
- West tunnel: conduit, service stencils, utility light, intermittent wiring sparks and two retracting access doors.
- Perimeter: six labeled bunker shutters, red light strips and pulsing spill lights. The distant skyline is scenery beyond the play bounds.
- Trader: inset supply graphics, telescoping lid and green intermission glow. Player start has a stopped-mode marker.

## Rendering and license

The installed `@threepipe/webgi-plugins/LICENSE` is GPL v3 with additional terms. It was not used. `post-unreal-bloom.js` and `post-luminosity.js` come from the installed three.js examples under the MIT license retained in `lib/view/post-LICENSE.txt`. Only their imports were changed. `MapPost` wraps UnrealBloomPass to decode and re-encode Threepipe's RGBM16 composer buffers. Vignette and film grain use Threepipe's screen-pass plugins. AO uses Threepipe SSAO at half resolution with four samples. The moon uses a 1024-pixel shadow map.

Static meshes are merged by material. Dynamic panels, hazard effects, pooled points and lights remain separate. Stop removes the map runtime, particles, lights, audio, bloom and added plugins, then restores prior fog, background, preview visibility and authored light visibility. The saved camera and text glTF were not changed.

## Knob triggers

All visual state is read by `MapView.sync(world)`. No map view method changes simulation rules.

| Core state or event | Visual |
| --- | --- |
| `world.configureMap({lights:{courtyard:'off',building:'off',dock:'off'}})` | Each named zone's real point light and fixture emission switch off. Set a zone to `on` to restore it. |
| `world.configureMap({fog:0..3})` | Exponential fog density: 0.002, 0.018, 0.035, 0.058. Level 0 retains only distant atmospheric haze. |
| `mapState.doors[id] = 'locked'` | Closed shutter with red indicator. |
| `mapState.doors[id] = 'unlocked'` | Shutter opens automatically within seven meters, before the player reaches it. |
| `mapState.doors[id] = 'open'` or `'closed'` | Explicit animated visual states are supported; the current core only collides `locked` doors. |
| `world.configureMap({hazards:[{slot:'courtyard_center',kind:'electric'}]})` | Floor glow, animated line arcs, flickering blue spill and synthesized 60 Hz hum. Works in either slot. Audio begins after a key or pointer gesture. |
| Hazard kind `steam` | Pooled drifting steam particles at the selected slot. |
| `world.configureMap({gates:['S1']})` | Active gate red lights pulse. A `unit_spawn` event whose unit is at that gate opens its shutter for 3.5 seconds. The event has no gate id, so the view matches the unit position to a gate. |
| `world.configureMap({break_flank_wall:true})` | The facing blocks crush downward inside the slot. The overlapping static collider and its wall remain. See the mismatch below. |
| `world.phase === 'intermission'` | Trader lid retracts and the green interior and point light illuminate. Other phases close it. |

## Screenshots

All PNGs are under `docs/evidence/w3/`:

- `courtyard-player-start.png`: camera at the exact player-start position, turned south to see the courtyard.
- `courtyard-wreck.png`
- `balcony.png`
- `interior-stairs.png`
- `tunnel.png`
- `dock.png`
- `fog-0.png`, `fog-1.png`, `fog-2.png`, `fog-3.png`
- `locked-door.png`
- `active-gate.png`
- `hazard-electric.png`
- `hazard-steam.png`
- `broken-wall.png`: collapsed facing with the overlapping wall still present.
- `open-trader.png`
- `light-zones-off.png`

These are explicitly staged map-state fixtures using the real MapView, PlayerView, procedural generator and Threepipe renderer. They are not evidence that full wave gameplay passes. The shared core could not load during this run. The fixture allowed map art, effects and cleanup to be verified without changing another agent's files.

## Measurement and checks

`render-results.json` contains the actual 360-frame requestAnimationFrame sample, renderer identity and assertions. At 1600 by 900, device scale 1, headless Google Chrome on Apple M3 Max: mean 16.666 ms, median 16.7 ms, p95 16.8 ms, p99 16.8 ms, maximum 16.8 ms, 60.003 fps, zero frames over 20 ms. Bloom, SSAO, grain, vignette, fog, both hazards, three active gate signals, all light zones and ambient particles were enabled. This is measured frame delivery for the environment fixture, not a GPU timer or a full combat benchmark.

All 39 structural collider bounds passed a geometry AABB containment assertion with a 0.00001 m floating-point tolerance. Twelve additional assertions passed for fog, all supported door states, spawn-driven opening, hazard selection, light cutoffs and cleanup. Browser warning/error messages: zero in the isolated render run. `doctor.txt` records the passing engine health check.

`kite3d-check.txt` and `kite3d-check.json` record the final integration result. The map generator passes static validation. At the time of this evidence, the full check was blocked by another workstream's core sandbox import:

```text
Headless check failed: Failed to resolve module specifier '@jitl/quickjs-wasmfile-release-sync/ffi'
```

Playable, Editable and Persisted therefore did not pass. No changes were made to the sandbox, package manifest, core, UI or GameManager to bypass that failure.

## Collider and contract mismatches

1. `wall_s_mid` spans x -8 to 8 at z -29.5. `flankWall` spans x -2 to 2 at the same location. Breaking the dynamic flank leaves the static wall intact in `activeColliders()`. The visual facing can crumble, but there is no usable opening. Removing the static wall visually would misrepresent the collider.
2. Original stair collider tops are 0.5, 1.25, 2, 2.75, 3.5, 4.25 m. The concurrently added `walkable.heightRules.stairTreadOffset` sets actual tread heights to center.y + 0.25: 0.5, 1, 1.5, 2, 2.5, 3 m. The generator follows those new surface heights while remaining inside each original box, and cuts the declared `movementHoles` out of the second-floor mesh. Collider bottoms above ground produce cantilevered treads.
3. `dock_ramp` collider top is 0.6 m. The new walkable ramp rises to 0.7 m, and the dock top is 0.7 m. Visual ramp vertices are capped at 0.6 m to obey collider containment. Up to 0.1 m of movement-height/visual mismatch remains at the upper end. The dock hazard grate at y 0.65 is also above parts of the ramp.
4. The trader has a map position and size, but it is absent from both static and dynamic collision lists. The core can allow walking through it. The view does not add gameplay collision.
5. Spawn gates have points and yaw but no collider volumes. Their shutter scenery is placed just outside the enforced play boundary behind the spawn positions, avoiding a new obstruction inside the navigable map.
6. The core only creates a door collider for `locked`, even if a caller writes `closed`. The view supports the requested closed animation, but only `locked` is physically closed in the current simulation.

No map data was edited to conceal these differences. Full collision-safe play and full-game 60 fps remain unverified until those shared-core contracts and the module loading failure are resolved.

## Reproduce

Keep the dedicated server on port 4500. `capture.mjs` reads its private connection snapshot from `/tmp/terminator-map-connection.json`; it never prints the token. For a new server session, copy only the current 4500 connection there with file mode 0600, or update the script's input path to that session's private file. Run `node docs/evidence/w3/capture.mjs`. The script uses the editor session to authenticate, then opens `preview.html`, exercises map state, captures the images, samples frames, and stops both views. Run `npx kite3d check` separately for whole-game verification.
