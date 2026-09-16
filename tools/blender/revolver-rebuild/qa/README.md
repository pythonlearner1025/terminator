# Imported revolver runtime QA

This proof uses the real **WeaponsLab** scene and its normal input/update path. The imported DJMaesen arms must be one combined skin with 49 native joints, 38 weighted joints, and matching `embeddedHandMeshes` metadata. Historical handmade-hand screenshots do not validate this rig.

## Approved immutable input

Wait for `coordination/revolver-retarget-ready.json` and explicit parent review approval. Copy the frozen export under the shared Blender lock, verify its hashes, and register **only in the isolated QA checkout**. The proof refuses an absent/changed approval hash, an old handmade export, or a registered asset that differs from the approved export. The SHA flag identifies the exact manifest reviewed by the parent; do not supply it before that review.

```sh
node tools/blender/revolver-rebuild/register.mjs tools/blender/revolver-rebuild/generated/assembled-imported
npx --no-install kite3d dev --port 4777 --no-open
```

Use exact 0.19.0-alpha.2 dependencies and an existing Playwright browser. Never install through the shared node_modules symlink. No browser download is attempted.

## Two serialized, bounded runs

Replace `APPROVED_MANIFEST_SHA256` with the approved manifest digest. `--export` may point to another isolated frozen staging directory. Both runs must use the same immutable manifest/export.

```sh
tools/blender/revolver-rebuild/qa/run.sh \
  --mode gameplay --out .kite3d/revolver-imported-gameplay \
  --export tools/blender/revolver-rebuild/generated/assembled-imported/revolver-rebuild.gltf \
  --manifest ../coordination/revolver-retarget-ready.json \
  --approved-manifest-sha APPROVED_MANIFEST_SHA256

tools/blender/revolver-rebuild/qa/run.sh \
  --mode check --out .kite3d/revolver-imported-check \
  --export tools/blender/revolver-rebuild/generated/assembled-imported/revolver-rebuild.gltf \
  --manifest ../coordination/revolver-retarget-ready.json \
  --approved-manifest-sha APPROVED_MANIFEST_SHA256

node tools/blender/revolver-rebuild/qa/summarize.mjs .kite3d/revolver-imported-gameplay
node tools/blender/revolver-rebuild/qa/summarize.mjs .kite3d/revolver-imported-check
node --test tools/blender/revolver-rebuild/qa/export-contract.test.mjs
```

The runner takes the shared `revolver-blender.lock`, requires at least 3 GiB MemAvailable, and creates one private Xvfb display and one headless browser/tab at 960×640. Inherited DISPLAY77 is unusable. Scope limits: MemoryMax1800M, MemoryHigh1600M, TasksMax192, CPUQuota200%, affinity to cores0–1, timeout120s. `finally` closes the browser; the shell also stops only its uniquely named scope on exit. Existing human browsers/displays and port4745 are never touched. `REVOLVER_QA_LOCK` can override the host-specific lock path, but must match the Blender owner's lock. Exit75 means resource preconditions were not met. `REVOLVER_QA_CHROMIUM` may select another already installed executable; the default is Playwright's lightweight headless shell.

Gameplay captures include hip, ADS, fire, five reload phases, sprint, authored Inspect, and restarted hip. It records actual skin samples/bone names, clone skeleton independence, all nine clips, marker positions, real weapon-projection sight pixels, clipping/framing, ammo, source/asset/PNG hashes, console/network errors, and resource-pressure samples. Pose timing uses normal director/range inputs with wall time frozen. Reload captures seek forward from the measured current reload progress and record requested/actual clip fractions with a one-tick tolerance; they fail if a requested phase has already passed. Only Inspect samples an authored clip, clearly marked. Contact stills do not certify continuous collision-free motion.

The Stop observer records `runtimeCleanupReport` synchronously after the original ECP.stop and before Kite disposes its Play viewer. Only stopped reports indicate cleanup success. It releases QA closures retaining the disposed viewer, then requests garbage collection in this private browser before the second editor Play. This is resource mitigation, not a stop-performance claim. Camera values are compared without transient UUIDs. Gameplay proof and official check are split to give each a full bounded run.

Check mode runs official `npx --no-install kite3d check` with a connected, stopped editor. A deliberately nonexistent child-only `PLAYWRIGHT_BROWSERS_PATH` prevents the CLI from launching a second fallback browser. `check.json` must come from this run; timeout/missing results are reported unavailable, never three passes. The command can save/reload the isolated scene as part of its normal persistence check.

## Self-contained actual-game comparison

```sh
node tools/blender/revolver-rebuild/qa/review-html.mjs \
  --proof .kite3d/revolver-imported-gameplay \
  --check .kite3d/revolver-imported-check \
  --skin tools/blender/revolver-rebuild/generated/imported-final-frozen/skin-roundtrip.json \
  --out tools/blender/revolver-rebuild/generated/revolver-imported-review.html
```

Optional `--historical .kite3d/revolver-proof-lab` embeds prior handmade-rig gameplay as an explicitly labeled comparison. Every displayed pose is an actual saved browser PNG; the HTML does not synthesize poses or substitute Blender previews. It validates recorded PNG hashes and includes source credit, pose/contact notes, export hashes, check results and ownership evidence. All images are embedded, so the page works offline.

The generator refuses to create a review with no imported gameplay evidence. Generated HTML, PNGs and runtime logs remain ignored. Commit only QA-owned scripts/docs; leave registry, scene and assets for parent integration.

The optional `--skin` embeds the independent skin comparison summary and verifies
its glTF hash against the gameplay export. Run `summarize.mjs` first. Restarted hip
compares against the first editor-viewport hip at the same measured canvas size;
the other pose captures use the expanded 960×640 canvas.

## Final imported run — 2026-09-15 UTC

Frozen source `524194f`, asset `b04f819`; runtime lib/scripts/main.js match reviewed
`d314ccd`. Immutable staging: `generated/imported-final-frozen`. Manifest SHA-256:
`13551b6d725a8afa11673b681ff894b18c2e1d707029648506b95e772a65c6c6`.

- All nine clips, 93 Blender/Three.js WORLD skin samples, all 4,246 source vertices:
  max error `6.652046845556906e-7 m`, RMS `2.765512563076196e-7 m`, tolerance `1e-5 m`.
- Gameplay: `.kite3d/revolver-imported-gameplay-final`, 14 PNGs, all summary
  assertions pass. Six shots, six cases ejected, fresh replacement presentation,
  native skin deformation, five measured Reload phases, and authored Inspect.
- Both Stops remove 23 tracked objects, 468 outside renderables, and one HUD.
  Second Play succeeds with stable owner counts and restored scene/camera.
- Official check: `.kite3d/revolver-imported-check-final/check.json`, `mode: editor`;
  Playable, Editable and Persisted all pass. Both private browsers closed.
- ADS at 960×640: front sight top `(480.0000,318.9826)`, rear top
  `(480.0000,318.5564)`; aiming reference `(480,320)`.
- Visual review found no camera-clipping sleeve strips in the captured poses.
  Raw bounds include offscreen forearm vertices behind the near plane; these counts
  alone do not indicate a visible strip. Opening/closure intentionally cross the
  lower view with the support arm. Hidden grip intersections and continuous
  inter-frame clearance remain outside this sampled visual approval.

The review page is `generated/revolver-imported-review.html`. See parent workspace
`coordination/revolver-final-game-qa.findings.md` for exact artifact hashes and
reproduction. Historical failed records and the pre-registration scene/registry
are preserved. Official persistence checking may rewrite the isolated scene;
registration itself preserved its bytes. No scene or asset changes are committed.

## Earlier restart stall

Saved preliminary evidence showed first Stop passing (23→0 tracked objects, 471→0 outside renderables, HUD1→0), followed by a second Play timeout. The old harness retained closures capturing the disposed viewer; those are now released. A separate official check stalled with memory.high events77,757, peak1,710,436,352 bytes and no OOM/task limit events. That implicates memory pressure but does not prove the sole cause. New imported-rig runs must establish whether the revised harness restarts successfully; no old-asset rerun is required.
