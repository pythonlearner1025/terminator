# Bunker 7 map pass

The footprint grows from 3,600 to 5,040 square metres. The original compound remains at the centre.
Added spaces: one underground loop, two entrances, one choke, one barracks block, one colonnade, and three perimeter shells.
The barracks has two interior floors, eight beds, open windows, two stair flights, and a reachable roof.
The colonnade has ten columns. Three new gates include S3, a seven-metre opening tagged `boss`.
Added cover: eight paired chest groups, five sandbag groups, four generators, four spools, one rubble bank, and two fire barrels.
Added atmosphere: fourteen fixtures, four fog areas, three steam vents, two spark emitters, and a 64-particle dust pool.
Four pooled local lights remain active at most. Surfaces reuse the licensed PBR sets in `assets/textures/map/`.
The 2048-pixel signage atlas carries baked wear. Capture validation found no missing albedo, normal, or roughness maps.

Reference findings: short interiors connect yards; broad doors maintain routes; edge cover preserves lanes; repeated lights identify exits; distant smoke separates buildings.
The [KF2 notes](../../reference/kf2/maps/NOTES.md) and [environment notes](../../reference/environment/NOTES.md) document the images studied.
References total 1.40 MB. They remain outside shipping assets.

## Measurements

Headless Chrome 152, ANGLE Metal, Apple M3 Max, 1920 by 1080, High, 24 enemies, all benchmark effects.
Each sample lasts twelve seconds after five seconds of warmup. The benchmark script remains unchanged.
The initial and repeated baselines use checkpoint `1ba35f2`. The repeat ran from an isolated copy inside this worktree.

| Build | CPU mean / p99 ms | GPU mean / p99 ms | Draw calls p99 | Triangles p99 | FPS |
|---|---:|---:|---:|---:|---:|
| Initial baseline, 08:33 UTC | 12.338 / 15.000 | 8.414 / 15.754 | 263 | 440,550 | 59.921 |
| Repeated baseline, 09:25 UTC | 22.928 / 29.800 | 22.217 / 38.430 | 263 | 440,058 | 39.894 |
| Final expansion, 09:45 UTC | 16.573 / 22.300 | 16.024 / 27.382 | 230 | 500,896 | 52.281 |

The 13.3 ms CPU/GPU p99 budget fails. The final kill spike takes 25.700 ms CPU and 16.663 ms GPU.
The final maximum GPU frame takes 31.959 ms. Baseline timing also changed substantially during the shared Mac session.
These samples cannot isolate the expansion's timing cost. Draw calls decreased, while submitted triangles increased.
Compact measurements are in `before.json`, `baseline-repeat.json`, and `after.json`. All three samples reported zero browser warnings.

## Validation

- `npm test`: 155 passed, zero failed.
- All 4,566 walkable cells connect when switchable doors open. The existing locked balcony still follows its original rule.
- Scout and Heavy traversal tests pass through both tunnel mouths, the choke, the barracks corridor, and the roof stairs.
- Nav candidates and cached connections match full scans across all layers, closed doorways, rotated boxes, and compound fixtures.
- Collider fit: 52 props pass. Maximum absolute error is 1.883 cm overall and 0.500 cm across 42 new props.
- `npm run scene` regenerates thirteen authored nodes. Playable, Editable, and Persisted pass without warnings in `check.json`.
- The bundled headless browser timed out before thirty frames. The Metal helper changes browser launch options only.

Run the server with `npx kite3d dev --port 4680 --no-open`. Then use the capture and benchmark tools:

```sh
node tools/capture-map.mjs
node tools/benchmark-browser.mjs --port=4680 --seconds=12 --warmup=5 --output=.kite3d/map-benchmark.json
```

Stop the server before running the same Kite3D checks with the benchmark's headless renderer:

```sh
NODE_OPTIONS="--require=./tools/check-headless-metal.cjs" npx kite3d check
```

## Four screenshots

All images are 1920 by 1080: [tunnel](tunnel.png), [house interior](house-interior.png), [colonnade](colonnade.png), [roof overview](roof-overview.png).

## Remaining gaps

The map remains below KF2 quality. Concrete shells repeat, interiors need more varied clutter, and damage lacks bespoke rubble meshes.
Local lights lack shadows and baked interior bounce. Fog uses layered planes. The required frame budget remains unmet.
