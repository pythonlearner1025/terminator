# Weapon feel and VFX pass

The pass improves all six existing viewmodels and combat effects. It does **not**
reach KF2 asset fidelity. No core data, combat logic, map, unit model, HUD, scene,
or dependency files changed. Code revision: `efd2c81` on `pass/weapons`.

- Six 2048 px PBR atlases replace vertex paint: albedo, normal, roughness,
  metalness, AO and emission. Materials include scratches, surface cavities,
  grip stipple, cloth weave and engraved markings. Provenance is in
  `assets/LICENSES.md`; `assets/textures/weapons/generate.py` rebakes them.
- Firearm scale, iron sights, firing-hand grip and sleeves were revised.
  Slides, bolts, pumps, magazines and plasma cells retain their articulation.
  The pistol locks open empty. Recoil has a spring return; sprint eases in.
- Muzzle flashes illuminate the world and hands. Fixed pools provide tracers,
  plasma, smoke, world-space brass, metal chips, concrete dust, bullet holes,
  plasma scorch, explosions, shockwaves and debris. Brass bounces at the
  sampled floor height. Bullet holes and scorches live up to 90 seconds and
  replace the oldest entries after their 64/16-slot caps are filled.
- Screen effects add directional damage, low-health desaturation, heartbeat
  pulses and local plasma refraction in the existing final screen pass.
- The canvas emits `terminator:weapon-sound` CustomEvents with `detail.kind`
  values `shell-bounce`, `reload-mechanism`, `heartbeat`, and `explosion-flash`.
  These are integration hooks; this pass adds no recorded audio samples.
- Visuals consume confirmed events and core timers. Grenades currently detonate
  immediately in core, with no fuse. Explosion visuals fire on that event tick;
  the hand animation begins at release. Cosmetic wall rays never call hitscan
  or consume core RNG. Core events omit miss endpoints, so wall decals use an
  approximate center ray rather than each pellet's true spread endpoint.

## Validation

`npm test`: **83 passed, 0 failed**. `verify.mjs`: **36 checks passed**, zero
browser errors. This covers read-only core state, empty/reload fire suppression,
reload completion, sight alignment, event deduplication, pump travel, muzzle
illumination, plasma refraction activation, case bounce hooks, explosion timing,
persistent impacts, damage effects, map loading, headshot hit-stop and cleanup.

`npx kite3d check`: **Playable PASS, Editable PASS, Persisted PASS**. Editable
retains Kite3D's `CAMERA_CONTAINMENT_UNVERIFIED` qualification. The full check
summary is in `checks.json`. Stop removes runtime roots, pooled instance buffers,
screen nodes and the screen shader extension; it restores canvas color.

## Evidence and reproduction

All five captures are 1920 x 1080. They use actual World inputs in a controlled
fixture, with simulation paused between captures. Inventory and target health
are configured for inspection. The headless test expands the canvas with local
CSS. This is not a recording of a normal wave.

1. `01-pistol-reload.png`: grip, material wear and magazine exchange.
2. `02-m4-fire.png`: M4, enemy contact and fire feedback.
3. `03-shotgun-pump.png`: pump cycle and support hand.
4. `04-plasma-fire.png`: plasma weapon, impact and incoming damage.
5. `05-grenade-explosion.png`: immediate core explosion and recovery pose.

Start `npx kite3d dev --port 4630 --no-open`, then run these from the project root:

```sh
node docs/evidence/pass-weapons/verify.mjs
node docs/evidence/pass-weapons/benchmark.mjs
node docs/evidence/pass-weapons/render-cost.mjs
```

All browser launches are headless. The benchmark intercepts five baseline view
modules from checkpoint `04f69da` without changing files or checking out Git.
It keeps 24 enemies alive, cycles all four firearms, and detonates four grenades.
Each ABBA run warms 120 frames and measures 240, with one fixed core tick per
rendered frame. GPU timing uses `EXT_disjoint_timer_query_webgl2` on the M3 Max.
`performance.json` records the full frame results. `render-cost.json` measures a
separate frozen explosion/plasma pose, alternating which render roots are visible;
that isolates rendering and cannot establish the dynamic frame budget.

## Performance result

Final ABBA run on code revision `efd2c81`, Chrome / ANGLE Metal / Apple M3 Max:

| Metric | Checkpoint baseline | This pass |
| --- | ---: | ---: |
| Mean complete frame | 17.59 ms | 17.70 ms |
| Median frame, two runs | 16.5 / 16.6 ms | 16.6 / 16.6 ms |
| p95 frame, two runs | 25.0 / 23.7 ms | 22.8 / 24.4 ms |
| Mean GPU time | 11.83 ms | 12.49 ms |
| Mean complete view update | 1.572 ms | 1.611 ms |

The measured added mean GPU cost is **0.66 ms**; the view update delta is
**0.039 ms**. The isolated frozen-pose comparison adds **0.27 ms mean GPU** and
**0.265 ms mean render submission** for visible weapons and all combat effects.
These satisfy the 1 ms limit on their measured means, not a worst-case bound.

**Sustained 60 fps is not achieved.** The final mean is about 56.5 fps. Earlier
same-session stress runs on the shared Mac reached roughly 40 ms mean frames.
The results are sensitive to concurrent load; this is not a robust 60 fps claim.
The complete dynamic 1 ms overhead limit is not established across that variation.

## Remaining gaps

The meshes and hands still read as procedural. They need authored hero meshes,
more realistic anatomy, fitted per-weapon grips and professional animation curves.
Atlas reuse is visible and markings are subtle at normal gameplay size. Smoke
uses billboards, not authored animated flipbooks. ADS softens texture mip levels;
it is not full optical depth of field. Effects do not reach KF2's density or
material response. The SMG, sniper and LMG are deferred until these gaps and the
performance target are resolved.
