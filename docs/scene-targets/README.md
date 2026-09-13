# Bunker 7 player POV references

The selected refactor target is **v2**: open `index.html` or `index-v2.html`. `active-reference.json` records this selection. V1 and V3 remain archived; `index-v3.html` also offers a comparison selector.

- `before/`: original, unedited game screenshots and capture manifest.
- `targets-v3/`, `prompts-v3/`: v3 edits using the real debris photograph to improve fragment scale, formation and surface variation while reducing grain.
- `targets-v2/`: preserved v2 targets based on James Cameron's original *The Terminator* (1984) and the user-supplied blue Future War still.
- `prompts/`: exact revised prompts; every generation takes its matching `before` image first and `references/terminator-1984-user-reference.png` second.
- `targets/`, `index-v1-rejected.html`, `prompts/v1-rejected/`: rejected first pass, retained for provenance.
- `views.json`: fixed supported player feet positions, look targets, FOV, viewport, seed and presentation tick.

## Reproduce after refactoring

From this worktree, with `npx kite3d dev` running:

```sh
node tools/capture-scene-targets.mjs docs/evidence/refactor-01
python3 tools/compare-scene-targets.py docs/evidence/refactor-01 --reference docs/scene-targets/targets-v2 --out docs/evidence/refactor-01-diff
```

Capture uses installed Chrome on macOS (override with `CHROME_PATH`) and Playwright. Comparison requires Pillow. The capture script refuses to overwrite existing shots. It runs in a separate runtime, retains the actual PlayerView, HUD and weapon, validates floor support/head clearance, and freezes simulation while rendering a fixed presentation tick. It does not save changes to the game scene.

The comparison command checks camera and rendering metadata, then measures masked RGB mean absolute error against the specified generated targets. Weapon/arms and HUD regions are conservatively excluded. Target images are resized to the capture resolution without a crop. The aggregate loss weights full-resolution, quarter-resolution and sixteenth-resolution MAE by 0.2, 0.3 and 0.5. Lower is closer in pixels; this is not a semantic quality score. Generated architecture can drift, so preserve actual navigation/collision requirements during refactoring.

`validation/repeatability/` measures two runs of the unchanged game against each other, not against target artwork. Its average masked multiscale loss was about 0.03% of channel range. `validation/baseline/` contains the old first-pass target scores and does not measure v2 or v3.

Rebuild the selected v2 gallery with `python3 tools/build-scene-comparison.py`. `tools/build-scene-comparison-v3.py` retains the v3 gallery builder.

See `convergence-plan.md` for the proposed refactor sequence.
