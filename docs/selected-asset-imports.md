# Selected scene asset imports

The selected Hangar Concrete Floor is installed across all 14 floor models (15 scene placements). Its local 1K diffuse, OpenGL normal, and packed AO/roughness/metalness maps use a consistent two-meter tile scale and neutral concrete tint. Scene IDs, transforms, geometry, colliders, and material names are preserved.

Play batching now distinguishes texture transforms, so slabs retain the same tile scale in the editor and during gameplay. Rebuilding map assets reapplies the selected floor automatically.

![Selected concrete floor in the running bunker scene](selected-floor.png)

## Remaining imports

This is a partial integration. The 25 unique selected Sketchfab models are still pending download and fitting. The official download endpoint requires authenticated access and returned HTTP 401 without it. Existing models remain active for these families.

`assets/sources/selected-assets.json` records the chosen sources, authors, licenses, target asset IDs, and pending status. The Heavy shares the selected Endo body; both HK variants share one selected vehicle set. The comparison and chosen-set pages remain under `docs/asset-comparison/`.

Keep the selected worn military-industrial direction: concrete gray, gunmetal, faded olive, localized rust, and restrained red warning lights and optics.

## Reproduce the floor import

```sh
npm run assets:selected:fetch
npm run assets:selected:apply-floor
```

The fetcher uses Poly Haven's official API, checks its MD5 checksums, and records SHA-256 hashes and attribution in `assets/sources/hangar-concrete-floor.json`. Committed maps allow normal development and builds without provider access.

## Acquire remaining models

Configure `SKETCHFAB_API_TOKEN` in the local environment, then run:

```sh
npm run assets:selected:fetch-models
```

The command uses the official Sketchfab download API and stores archives in the Git-ignored `.kite3d/selected-downloads/` folder. It deduplicates shared source models. Credentials and signed download URLs are not written to receipts. This command downloads archives only; it does not install them into the scene.

After download, inspect each archive's license and resources, fit the meshes to existing scene bounds, and adapt articulated parts to the existing rigs and gameplay animation names. Preserve the stable authored IDs and collision geometry. Add the included model attribution to `assets/LICENSES.md`, then validate the scene before marking those imports complete.

## Validation

- `npx kite3d doctor`: all checks pass.
- `NODE_OPTIONS="--require=./tools/check-headless-metal.cjs" npx kite3d check`: Playable, Editable, and Persisted pass using the repository's existing Mac renderer helper. The default headless renderer timed out on this machine.
- Full `npm test`: 237/238 pass while Chrome validation ran concurrently. The simulation throughput benchmark failed under that load; rerunning `node --test test/core/sim/sim.test.js` alone passes all six tests.
- The three new floor integration and texture-transform batching tests pass.
- Editor inspection finds all 15 floor placements with loaded maps and the expected repeat scale; no browser errors.
- Runtime captures at four map viewpoints show no browser errors or missing PBR maps.
