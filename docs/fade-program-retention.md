# Fade shader program retention

## Cause and minimal fix

Warmup already compiled the required transparent variants. `Mesh2.material` dispatches `materialChanged`; Threepipe `Object3DManager._materialChanged` unregisters the outgoing material **before** registering the incoming material. `_unregisterMaterial` disposes a last-use material and unregisters its textures. Three.js handles the material's `dispose` event by releasing its program references. Warmup's fade reset therefore evicted all six active/idle fade programs, and subsequent fades recompiled and evicted them again.

The browser recorded the disposal stack and the program references on the affected material. All three final natural-soak cache keys match the pre-reset warmup keys byte-for-byte. There is **no missing fade variant**. Comparing to the nearest *surviving opaque* program instead gives `outputColorSpace: rgbm-16 → srgb-linear` and removes boolean bit 17 (`opaque`, 131072); skinned draws retain bit 4. Those differences describe the transparent render target and opacity path, not a warmup omission.

`RagdollSystem` now receives the view's existing resource manager and uses `retainResourcesDuring` around the two synchronous material assignments: entering fade and restoring the original material. Manager disposal flags restore immediately. The existing owners still explicitly dispose pooled fade materials at Stop; transient fallback fade clones still dispose on release. No additional hidden meshes, material clones, program keepers, renderer patches, scene changes, or rendering changes.

## Measured verification

Actual DOM Start, Vulkan, DISPLAY `:1`, CPUs `0,1`, 480×270, high quality. Real combat deaths create endo/heavy corpses, gore, HK-Aerial debris and HK-Tank debris. Only settled age is accelerated to cross 180 seconds; normal updates and rendering perform the two-second fades and expiry. Two separated rounds reset the pools between rounds.

| Stage | DOM Start ready | Programs before/after warmup reset | Fade draw IDs: skinned / gore / HK | Disposal events per round |
| --- | ---: | --- | --- | --- |
| Old | 5.139 s | 223 / 217 | 236 / 238 / 237; then 239 / 240 / 241 | 17 / 17 |
| Fixed | 5.245 s | 223 / 223 | 216 / 206 / 209 in both rounds | 0 / 0 |

Fixed IDs are the original warmed programs. Per-frame inventory comparison, including ID replacement at unchanged counts, observed **zero program additions or removals after warmup**. Actual fade draws independently recorded names, IDs, full cache keys, prepared material identity and opacity. Each round ended with zero ragdoll records. Stop cleared runtime roots, owner, dormant root, world and ragdoll system; both stages ended at 81 programs and no fade program keys remained.

Fresh official **headless** Kite3D check: Playable PASS, Editable PASS, Persisted PASS. The headless policy report records 3,239,395,328 bytes peak and the 3.5 GiB guard. An earlier official invocation connected to an editor and also passed; the fresh headless result is the acceptance artifact. Final focused CPU suite: **60 PASS**, serial with a 512 MiB JS heap cap. The new regression fails on old code using real Mesh2/Object3DManager material and shared-texture disposal events; it also checks transient fade clones still dispose at release.

## Limits and resource handling

One owned browser at a time. Several attempts were closed by the >3.5 GiB guard, including the fixed reload after the completed old stage. Thus the completed old and fixed stages used sequential fresh browser processes, not one uninterrupted process. Every attempt retained MemoryMax/High 4 GiB and TasksMax 384. Final fixed peak was 3,271,516,160 bytes, zero swap and no OOM. Task-only file-cache reclaim runs before launch and below the guard threshold; no global cache drops. The kernel rejected the initially attempted `swappiness=0` reclaim option; the successful run used numeric reclaim with task swap disabled.

This is a bounded fade/cache-lifecycle probe, not a new four-minute soak or an FPS claim. All appearances, PBR maps, lights, geometry and the production 180+2 second corpse lifetime are unchanged. Publishing was not attempted; the external API404 remains outside this task.

## Artifacts

- `docs/evidence/fade-program-retention-{old,fixed}.json`: raw program inventories, real draw keys, disposal stacks, crossings and Stop.
- `docs/evidence/fade-program-retention-summary.json`: exact key comparison to the previous natural soak, production file hashes, per-family results and guard attempts.
- `tools/v2/verify-fade-retention.mjs`: repeatable bounded probe. Set `FADE_STAGE=old` or `fixed`; its default two-stage mode waits for `.kite3d/fade-fixed-ready` after the old stage. Use a fresh gate file for a new two-stage run.
- CPU and official-check results are recorded alongside the raw reports.
