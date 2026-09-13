# Store package

`description.txt` contains the two-line listing description. `icon.png` is a 512 x 512
rasterization of the root `icon.svg`. The production copy is `assets/store/icon.png`.

Six unretouched 1920 x 1080 captures:

1. [01-menu.png](01-menu.png): live Endo stage.
2. [02-bunker.png](02-bunker.png): Bunker 7, first-wave HUD on Hard.
3. [03-rifle.png](03-rifle.png): courtyard, M4.
4. [04-shotgun.png](04-shotgun.png): dock approach, shotgun.
5. [05-plasma.png](05-plasma.png): courtyard flank, plasma rifle.
6. [06-trader.png](06-trader.png): intermission loadout and purchases.

These are the actual game renderer and UI, captured with headless Chromium. The weapon
shots use staged core positions and loadouts, advancing the existing switch animation
before freezing the capture. They are not proof of natural playthrough progress.
The map, gameplay unit meshes, weapons, and effects belong to the other visual passes
and remain below the KF2 target in this branch. Replace the store captures after those
passes merge using `node /Users/minjunes/games/terminator-evidence/docs/evidence/pass-presentation/capture.mjs`.

The menu owns six 1024 x 1024 PBR maps. Rebuild them with `python3 docs/store/build-materials.py`
(Pillow and NumPy). Per-file provenance is in `assets/store/LICENSES.md`.

## Integration contract

Difficulty is selected through `WaveDirector.setDifficulty(id)` in the lobby. It refuses
changes during a match. `difficultyScaling(players, id)` combines the table below with
the existing co-op multipliers; max-alive and performance adaptation stay unchanged.
The director includes the chosen difficulty in its state and in the world scaling block.
Normal keeps the original snapshot shape. Missing difficulty means Normal.

| ID | Label | Budget | Unit health |
| --- | --- | --- | --- |
| normal | Normal | 1.00 | 1.00 |
| hard | Hard | 1.25 | 1.15 |
| suicidal | Suicidal | 1.50 | 1.35 |
| hell | Hell on Earth | 1.80 | 1.60 |

Existing party snapshots transmit scaling to guests. The UI adapter forwards the director's
budget to the legacy Skynet lobby API and defers first-wave planning until Start.
The server's static rules endpoint still defaults to solo Normal scaling; its live budget
and subsequent wave summaries carry the selected values. Server rules/session metadata
should be aligned in the networking pass.

`MenuScene` uses the full existing Endo generator when the authored template contains only
its bounded block preview. It clones a detailed template and its skeleton if one is present.
Runtime ownership stays linked to the authored Endo source. Camera, fog, textures, skeletons,
DOM, and event listeners are restored or removed on stop. Cached unit SSAO extensions are
detached at UI teardown to prevent a duplicate shader uniform on the next match.

The loading bar counts completion of six menu textures plus the Barlow font. The engine's
earlier scene/module bootstrap remains outside this UI hook. The controls card is stored
under `terminator.settings.v1`; all 24 bindings are also saved there. Physical `KeyboardEvent.code`
values are used, including mouse buttons; overlapping context bindings swap on reassignment.
Escape remains available for Back even if Pause is rebound.
